import { describe, expect, it } from "vitest";
import { classifyCode, isUnitSerial } from "../src/barcodeClassify.js";

describe("classifyCode", () => {
  it.each([
    ["M393A4K40DB3-CWE", "Samsung", "DIMM"],
    ["HMA84GR7AFR4N-VK", "SK Hynix", "DIMM"],
    ["MTA36ASF4G72PZ-2G9E2", "Micron", "DIMM"],
    ["ST4000NM0035", "Seagate", "HDD"],
    ["HUS726T6TALE6L4", "HGST", "HDD"],
    ["MZ7LH960HAJR-00005", "Samsung", "SSD"],
    ["SSDSC2KG960G8", "Intel", "SSD"],
    ["MTFDDAK960TDS", "Micron", "SSD"],
    ["MCX4121A-ACAT", "Mellanox", "NIC"],
    ["900-2G500-0010-000", "NVIDIA", "GPU"],
  ])("recognises %s as a %s part number", (text, manufacturer, category) => {
    const classified = classifyCode(text);
    expect(classified.kind).toBe("partNumber");
    expect(classified.partNumber).toBe(text.toUpperCase());
    expect(classified.manufacturerHint).toBe(manufacturer);
    expect(classified.categoryHint).toBe(category);
  });

  it("extracts the Dell part number from a PPID and treats the PPID as the unit serial", () => {
    const classified = classifyCode("CN-0HW7NR-78931-53P-0123-A00");
    expect(classified.kind).toBe("ppid");
    expect(classified.partNumber).toBe("0HW7NR");
    expect(classified.manufacturerHint).toBe("Dell");
    expect(isUnitSerial(classified)).toBe(true);
  });

  it("reads a PPID printed without dashes", () => {
    expect(classifyCode("CN0HW7NR7893153P0123A00")).toMatchObject({ kind: "ppid", partNumber: "0HW7NR" });
  });

  it("recognises a bare Dell part number", () => {
    expect(classifyCode("0G6W6C")).toMatchObject({ kind: "partNumber", partNumber: "0G6W6C", manufacturerHint: "Dell" });
  });

  it("recognises HPE spare and option numbers", () => {
    expect(classifyCode("865414-B21")).toMatchObject({ kind: "partNumber", manufacturerHint: "HPE" });
    expect(classifyCode("684539-001")).toMatchObject({ kind: "partNumber", manufacturerHint: "HPE" });
  });

  it("recognises MAC addresses with and without separators", () => {
    expect(classifyCode("00:1B:21:3A:4F:5C").kind).toBe("macAddress");
    expect(classifyCode("001B213A4F5C").kind).toBe("macAddress");
  });

  it("recognises a drive WWN", () => {
    expect(classifyCode("5000C500A1B2C3D4").kind).toBe("wwn");
  });

  it("recognises UPC codes and passes them through as lookup numbers", () => {
    expect(classifyCode("012345678905")).toMatchObject({ kind: "upc", partNumber: "012345678905" });
  });

  it("treats other alphanumeric codes as serials", () => {
    const classified = classifyCode("ZC1ABC23");
    expect(classified.kind).toBe("serial");
    expect(classified.partNumber).toBeNull();
    expect(isUnitSerial(classified)).toBe(true);
  });

  it("ignores URLs, blanks and very short text", () => {
    expect(classifyCode("https://example.com/x").kind).toBe("unknown");
    expect(classifyCode("   ").kind).toBe("unknown");
    expect(classifyCode("AB").kind).toBe("unknown");
  });
});
