import { describe, expect, it } from "vitest";
import { extractLabelFields } from "../src/labelText.js";
import { identifyFromText } from "../src/textIdentity.js";

describe("identifyFromText", () => {
  it.each([
    ["DELL EMC\nPowerEdge R740xd", "Dell PowerEdge R740XD", "CHASSIS"],
    ["Hewlett Packard Enterprise ProLiant DL380 Gen10", "HPE ProLiant DL380 Gen10", "CHASSIS"],
    ["Lenovo ThinkSystem SR650", "Lenovo ThinkSystem SR650", "CHASSIS"],
    ["cisco Catalyst 9300-48P", "Cisco Catalyst 9300-48P", "NETWORK"],
    ["PERC H730P Mini", "Dell PERC H730P", "RAID"],
    ["Mellanox ConnectX-4 Lx EN", "Mellanox ConnectX-4 LX", "NIC"],
    ["Intel(R) Xeon(R) Gold 6130 CPU @ 2.10GHz", "Intel Xeon Gold 6130", "CPU"],
    ["SIEMENS SITOP PSU8600", "Siemens SITOP PSU8600", "PSU"],
    ["Seagate Exos 7E8 8TB", "Seagate Exos 7E8", "HDD"],
  ])("%s names the item %s", (text, productName, category) => {
    expect(identifyFromText(text)).toMatchObject({ productName, category });
  });

  it("finds the brand and builds a search from brand and part number when no product name is printed", () => {
    const identity = identifyFromText("SIEMENS\nInput 400-500V 3AC\nOutput 24V DC / 20A", "6EP3346-7SB00-3AX0");
    expect(identity).toMatchObject({ brand: "Siemens", productName: null, searchQuery: "Siemens 6EP3346-7SB00-3AX0" });
  });

  it("keeps every readable line as evidence and drops symbol noise", () => {
    const identity = identifyFromText("SIEMENS\n~~ %%\nOutput 24V DC / 20A\nx");
    expect(identity.allText).toBe("SIEMENS | OUTPUT 24V DC / 20A");
  });

  it("does not take the word SMART on a drive health line for a brand", () => {
    expect(identifyFromText("SMART status passed").brand).toBeNull();
  });
});

describe("more label prefixes", () => {
  it("reads order, article and manufacturer part numbers", () => {
    expect(extractLabelFields("Order No.: 6EP3346-7SB00-3AX0")).toEqual([{ text: "6EP3346-7SB00-3AX0", hint: "partNumber" }]);
    expect(extractLabelFields("Mfr P/N: ABC-12345")).toEqual([{ text: "ABC-12345", hint: "partNumber" }]);
    expect(extractLabelFields("Art. No. 2866792")).toEqual([{ text: "2866792", hint: "partNumber" }]);
  });

  it("ignores Type and Ref values that are ordinary words", () => {
    expect(extractLabelFields("Type: DDR4")).toEqual([]);
    expect(extractLabelFields("Type: PSU8600-20A")).toEqual([{ text: "PSU8600-20A", hint: "partNumber" }]);
  });
});
