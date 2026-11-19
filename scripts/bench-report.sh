#!/usr/bin/env bash
# Reads drives, memory, CPUs and PCI cards straight from the hardware and sends them to a Teardown Scanner session.
# Run as root on a PC booted from a Linux USB (or on the server itself before teardown):
#   sudo ./bench-report.sh https://your-app.vercel.app 123456
#   sudo ./bench-report.sh https://your-app.vercel.app 123456 --drives-only   # bench PC with a drive dock: skip its own RAM/CPU
# The 6-digit code is shown on the bench screen under "Bench PC code". Needs: curl, smartctl (smartmontools), dmidecode, lspci (pciutils).
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: sudo $0 <app-url> <pairing-code> [--drives-only]" >&2
  exit 2
fi

app_url="${1%/}"
pairing_code="$2"
drives_only="${3:-}"

if [[ ! "$pairing_code" =~ ^[0-9]{6}$ ]]; then
  echo "The pairing code is the 6 digits shown on the bench screen." >&2
  exit 2
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: reading drive serials and memory details needs root." >&2
  exit 2
fi

for required_tool in curl smartctl; do
  command -v "$required_tool" >/dev/null || { echo "Missing $required_tool. Install it (e.g. apt install smartmontools curl) and retry." >&2; exit 2; }
done

report_file="$(mktemp)"
trap 'rm -f "$report_file"' EXIT

echo "===PAIRING $pairing_code" >> "$report_file"

# Every whole disk: SATA/SAS show up as sd*, NVMe as nvme*n*
while read -r disk_name disk_type; do
  [[ "$disk_type" == "disk" ]] || continue
  case "$disk_name" in loop*|ram*|zram*|sr*) continue ;; esac
  echo "Reading /dev/$disk_name" >&2
  echo "===SMARTCTL /dev/$disk_name" >> "$report_file"
  smartctl --json -a "/dev/$disk_name" >> "$report_file" 2>/dev/null || true
done < <(lsblk -dno NAME,TYPE)

if [[ "$drives_only" != "--drives-only" ]]; then
  if command -v dmidecode >/dev/null; then
    echo "===DMIDECODE-MEMORY" >> "$report_file"
    dmidecode -t memory >> "$report_file" 2>/dev/null || true
    echo "===DMIDECODE-PROCESSOR" >> "$report_file"
    dmidecode -t processor >> "$report_file" 2>/dev/null || true
  else
    echo "dmidecode not found: memory and CPUs skipped." >&2
  fi
  if command -v lspci >/dev/null; then
    echo "===LSPCI" >> "$report_file"
    lspci -vmm >> "$report_file" 2>/dev/null || true
  else
    echo "lspci not found: PCI cards skipped." >&2
  fi
fi

echo "Sending report to $app_url ..." >&2
curl --fail-with-body -sS -X POST -H "Content-Type: text/plain" --data-binary "@$report_file" "$app_url/api/hardware-reports"
echo
