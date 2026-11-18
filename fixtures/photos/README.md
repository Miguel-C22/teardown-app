# Photo set for `npm run vision:eval`

Real photos from our benches, used to measure label-reading accuracy against the live vision API.
Photos can show customer asset tags: keep this folder out of git and delete it when the PoC ends.

For each photo add a `.json` file with the same name:

```json
{ "image": "r740-dimm-01.jpg", "kind": "closeup", "serverModel": "PowerEdge R740",
  "expected": { "partNumber": "M393A4K40CB2-CTD", "serial": "S1AB2C3D", "category": "DIMM" } }
```

```json
{ "image": "r740-open-01.jpg", "kind": "sweep", "serverModel": "PowerEdge R740",
  "expected": { "counts": { "DIMM": 12, "CPU": 2, "PSU": 2, "SSD": 4, "RAID": 1 } } }
```

Aim for 10–20 cases: whole open chassis views plus close-ups of DIMM, drive, PSU, NIC and RAID labels,
and a CPU with its heatsink removed. The key number in the summary is "Wrong part number marked as read": it must be 0.
