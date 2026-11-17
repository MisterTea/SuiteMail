import { describe, it, expect } from "vitest";
import { detectShipmentsAndFlights } from "./trackingDetector";

describe("detectShipmentsAndFlights", () => {
  it("detects UPS tracking numbers (1Z...)", () => {
    const text = "Your package has shipped! Tracking number is 1Z9999999999999999. Expected delivery tomorrow.";
    const items = detectShipmentsAndFlights(text);
    expect(items.length).toBe(1);
    expect(items[0]?.carrier).toBe("UPS");
    expect(items[0]?.trackingNumber).toBe("1Z9999999999999999");
    expect(items[0]?.trackingUrl).toContain("1Z9999999999999999");
  });

  it("detects FedEx tracking numbers when FedEx is mentioned", () => {
    const text = "FedEx shipment notification: your order #456 with tracking 123456789012 has left the facility.";
    const items = detectShipmentsAndFlights(text);
    expect(items.length).toBe(1);
    expect(items[0]?.carrier).toBe("FedEx");
    expect(items[0]?.trackingNumber).toBe("123456789012");
  });

  it("detects USPS tracking numbers", () => {
    const text = "Delivering via USPS: tracking 9400100000000000000000.";
    const items = detectShipmentsAndFlights(text);
    expect(items.length).toBe(1);
    expect(items[0]?.carrier).toBe("USPS");
    expect(items[0]?.trackingNumber).toBe("9400100000000000000000");
  });

  it("detects airline flight confirmation codes", () => {
    const text = "Thank you for booking with United Airlines. Confirmation code: ABC12X.";
    const items = detectShipmentsAndFlights(text);
    expect(items.length).toBe(1);
    expect(items[0]?.carrier).toBe("Flight");
    expect(items[0]?.trackingNumber).toBe("ABC12X");
  });

  it("returns empty array when no tracking is in text", () => {
    const text = "Hey let's meet up for coffee tomorrow afternoon!";
    expect(detectShipmentsAndFlights(text)).toEqual([]);
  });
});
