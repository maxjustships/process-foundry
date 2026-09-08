import { afterAll, describe, expect, it } from "vitest";
import { formatDisplayDate } from "../../app/lib/display-date";

const originalTimezone = process.env.TZ;

afterAll(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe("formatDisplayDate", () => {
  it("returns identical explicit UTC output across runtime timezones", () => {
    const timestamp = "2024-01-02T03:04:00.000Z";

    process.env.TZ = "Pacific/Honolulu";
    const honolulu = formatDisplayDate(timestamp, "en");
    process.env.TZ = "Asia/Almaty";
    const almaty = formatDisplayDate(timestamp, "en");

    expect(honolulu).toBe("02 Jan 2024, 03:04 UTC");
    expect(almaty).toBe(honolulu);
  });
});
