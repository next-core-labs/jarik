import { describe, expect, it } from "vitest";

import { isInSaudi, parseLocation } from "./location-input";

describe("parseLocation", () => {
  it("reads a bare pair, with Arabic digits and comma", () => {
    expect(parseLocation("24.8073, 46.6129")).toEqual({ lat: 24.8073, lng: 46.6129 });
    expect(parseLocation("٢٤٫٨٠٧٣، ٤٦٫٦١٢٩")).toEqual({ lat: 24.8073, lng: 46.6129 });
  });

  it("prefers the place pin over the map centre in a Google Maps link", () => {
    const url =
      "https://www.google.com/maps/place/x/@24.80,46.60,17z/data=!3m1!4b1!4m6!3m5!3d24.8073!4d46.6129";
    expect(parseLocation(url)).toEqual({ lat: 24.8073, lng: 46.6129 });
  });

  it("reads @lat,lng and ?q=lat,lng links", () => {
    expect(parseLocation("https://www.google.com/maps/@21.5433,39.1728,15z")).toEqual({
      lat: 21.5433,
      lng: 39.1728,
    });
    expect(parseLocation("https://maps.google.com/?q=24.7136,46.6753")).toEqual({
      lat: 24.7136,
      lng: 46.6753,
    });
  });

  it("returns null for short links and text without coordinates", () => {
    expect(parseLocation("https://maps.app.goo.gl/AbCdEf123")).toBeNull();
    expect(parseLocation("حي الملقا")).toBeNull();
    expect(parseLocation("")).toBeNull();
  });
});

describe("isInSaudi", () => {
  it("accepts Riyadh and rejects swapped coordinates", () => {
    expect(isInSaudi({ lat: 24.71, lng: 46.67 })).toBe(true);
    expect(isInSaudi({ lat: 46.67, lng: 24.71 })).toBe(false);
  });
});
