import { describe, expect, it } from "vitest";
import { classifyCode } from "../src/barcodeClassify.js";
import { groupCodesIntoLabels, type DecodedCode } from "../src/labelGroup.js";
import { extractLabelFields } from "../src/labelText.js";
import { isTwoDimensionalFormat, parseTwoDimensionalPayload } from "../src/qrPayload.js";

const box = (x: number, y: number) => ({ x, y, width: 200, height: 40 });

describe("parseTwoDimensionalPayload", () => {
  it("reads an ANSI MH10.8.2 envelope by its data identifiers", () => {
    const payload = "[)>\u001e06\u001d1PST2000DM001\u001dSZ1E41HH0\u001d2PCC26\u001e\u0004";
    expect(parseTwoDimensionalPayload(payload)).toEqual([
      { text: "ST2000DM001", hint: "partNumber" },
      { text: "Z1E41HH0", hint: "serial" },
      { text: "CC26", hint: "version" },
    ]);
  });

  it("reads Cisco PID / VID / SN text", () => {
    expect(parseTwoDimensionalPayload("PID: WS-C3850-48P-S VID: V02 SN: FOC1234X0YZ")).toEqual([
      { text: "WS-C3850-48P-S", hint: "partNumber" },
      { text: "V02", hint: "version" },
      { text: "FOC1234X0YZ", hint: "serial" },
    ]);
  });

  it("reads bracketed GS1", () => {
    expect(parseTwoDimensionalPayload("(01)00888182123456(21)ABC12345(240)1CH164-302")).toEqual([
      { text: "00888182123456", hint: null },
      { text: "ABC12345", hint: "serial" },
      { text: "1CH164-302", hint: "partNumber" },
    ]);
  });

  it("splits plain multi-line payloads and ignores links and long tracking codes", () => {
    expect(parseTwoDimensionalPayload("ST2000DM001\nZ1E41HH0")).toEqual([
      { text: "ST2000DM001", hint: null },
      { text: "Z1E41HH0", hint: null },
    ]);
    expect(parseTwoDimensionalPayload("https://example.com/part/123")).toEqual([]);
    expect(parseTwoDimensionalPayload("A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7")).toEqual([]);
  });

  it("knows which decoder formats are 2D", () => {
    expect(isTwoDimensionalFormat("QRCode")).toBe(true);
    expect(isTwoDimensionalFormat("DataMatrix")).toBe(true);
    expect(isTwoDimensionalFormat("Code128")).toBe(false);
    expect(isTwoDimensionalFormat(undefined)).toBe(false);
  });
});

describe("QR codes next to barcodes", () => {
  it("keeps the 1D serial when the QR holds a different tracking value", () => {
    const codes: DecodedCode[] = [
      { text: "ST2000DM001", box: box(0, 0), format: "Code128" },
      { text: "Z1E41HH0", box: box(0, 45), format: "Code128" },
      { text: "XQ77TRACK9921", box: box(210, 0), format: "QRCode" },
    ];
    const labels = groupCodesIntoLabels(codes);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ serial: "Z1E41HH0", partNumber: "ST2000DM001" });
  });

  it("uses the QR's fields when there is no barcode for them", () => {
    const codes: DecodedCode[] = [{ text: "PID: GLC-SX-MMD VID: V01 SN: AGM1234ABCD", box: box(0, 0), format: "QRCode" }];
    const labels = groupCodesIntoLabels(codes);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ partNumber: "GLC-SX-MMD", serial: "AGM1234ABCD", categoryHint: "OPTIC", manufacturerHint: "Cisco" });
  });

  it("a QR repeating the barcode's serial does not create a second part", () => {
    const codes: DecodedCode[] = [
      { text: "Z1E41HH0", box: box(0, 0), format: "Code128" },
      { text: "Z1E41HH0", box: box(210, 0), format: "QRCode" },
    ];
    expect(groupCodesIntoLabels(codes)).toHaveLength(1);
  });

  it("a plain QR with two serial-looking values is still one part", () => {
    const codes: DecodedCode[] = [{ text: "AB12CD34EF\nZZ99YY88XX", box: box(0, 0), format: "QRCode" }];
    expect(groupCodesIntoLabels(codes)).toHaveLength(1);
  });
});

describe("Cisco labels", () => {
  it.each([
    ["WS-C3850-48P-S", "NETWORK"],
    ["C9300-24T", "NETWORK"],
    ["N9K-C93180YC-EX", "NETWORK"],
    ["ISR4331/K9", "NETWORK"],
    ["GLC-SX-MMD", "OPTIC"],
    ["SFP-10G-SR", "OPTIC"],
    ["PWR-C1-715WAC", "PSU"],
    ["UCS-MR-X32G2RW", "DIMM"],
  ])("%s is a Cisco PID under %s", (pid, category) => {
    expect(classifyCode(pid)).toMatchObject({ kind: "partNumber", partNumber: pid, manufacturerHint: "Cisco", categoryHint: category });
  });

  it("reads a Cisco serial and VID", () => {
    expect(classifyCode("FOC1234X0YZ")).toMatchObject({ kind: "serial", manufacturerHint: "Cisco" });
    expect(classifyCode("V02")).toMatchObject({ kind: "version" });
  });

  it("does not take an 11-character drive model for a Cisco serial", () => {
    expect(classifyCode("ST2000DM001").kind).toBe("partNumber");
  });
});

describe("extractLabelFields (OCR text)", () => {
  it("reads keyed values and trusted unkeyed part numbers, skipping noise", () => {
    const ocrText = "Seagate BarraCuda 2TB\nST2000DM001\nS/N: Z1E41HH0  PN: 1CH164-302\nFW: CC26 Date: 13395 Site: WU\nMade in Thailand";
    expect(extractLabelFields(ocrText)).toEqual([
      { text: "Z1E41HH0", hint: "serial" },
      { text: "1CH164-302", hint: "partNumber" },
      { text: "ST2000DM001", hint: null },
    ]);
  });

  it("reads a Cisco label", () => {
    expect(extractLabelFields("PID: C9300-24T  VID: V03  SN: FOC2233X1AB")).toEqual([
      { text: "C9300-24T", hint: "partNumber" },
      { text: "V03", hint: "version" },
      { text: "FOC2233X1AB", hint: "serial" },
    ]);
  });
});
