import { describe, expect, it } from "vitest";
import { classifyCode } from "../src/barcodeClassify.js";
import { decodePartNumber } from "../src/partDecoders.js";

describe("decodePartNumber", () => {
  it.each([
    ["M393A4K40CB2-CTD", "Samsung 32GB DDR4-2666 RDIMM", "DIMM"],
    ["M393A2K40BB1-CRC", "Samsung 16GB DDR4-2400 RDIMM", "DIMM"],
    ["M386A8K40BM1-CRC", "Samsung 64GB DDR4-2400 LRDIMM", "DIMM"],
    ["HMA84GR7AFR4N-UH", "SK Hynix 32GB DDR4-2400 RDIMM", "DIMM"],
    ["HMA82GR7CJR8N-VK", "SK Hynix 16GB DDR4-2666 RDIMM", "DIMM"],
    ["MTA36ASF4G72PZ-2G6E1", "Micron 32GB DDR4-2666 RDIMM", "DIMM"],
    ["MTA18ASF2G72PDZ-2G9E1", "Micron 16GB DDR4-2933 RDIMM", "DIMM"],
    ["ST2000DM001", "Seagate BarraCuda 2TB drive", "HDD"],
    ["ST4000NM0035", "Seagate Exos 4TB drive", "HDD"],
    ["ST600MM0006", "Seagate Enterprise Performance 600GB drive", "HDD"],
    ["SR3B9", "Intel Xeon Gold 6130", "CPU"],
  ])("%s decodes to %s", (partNumber, name, category) => {
    expect(decodePartNumber(partNumber)).toMatchObject({ name, category });
  });

  it("returns nothing rather than guessing for unknown naming", () => {
    expect(decodePartNumber("HMAA8GR7AJR4N-XN")).toBeNull();
    expect(decodePartNumber("SR9ZZ")).toBeNull();
    expect(decodePartNumber("0HW7NR")).toBeNull();
    expect(decodePartNumber(null)).toBeNull();
  });

  it("classifies an Intel sSpec marking as a CPU part number", () => {
    expect(classifyCode("SR3B9")).toMatchObject({ kind: "partNumber", manufacturerHint: "Intel", categoryHint: "CPU" });
  });
});
