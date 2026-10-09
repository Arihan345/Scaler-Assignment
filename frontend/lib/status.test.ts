import { describe, expect, it } from "vitest";
import fixtures from "../../shared/status_fixtures.json";
import { computeStatus } from "./status";

describe("computeStatus (shared fixtures with the backend)", () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      expect(computeStatus(c.seq, c.sender_id, c.members)).toBe(c.expected);
    });
  }
});
