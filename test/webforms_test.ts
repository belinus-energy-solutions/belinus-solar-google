function assertEquals(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
import { formatFields, validate } from "../src/webforms.ts";

Deno.test("validate", () => {
  assertEquals(validate("quote", { _email: "a@b.be", _consent: true }), null);
  assertEquals(validate("quote", { _email: "a@b.be" }), "consent_required");
  assertEquals(validate("quote", { _email: "nope", _consent: true }), "invalid_email");
  assertEquals(validate("x", { _email: "a@b.be", _consent: true }), "unknown_form");
  assertEquals(validate("contact", { _email: "a@b.be", _consent: true, _hp: "bot" }), "spam");
  assertEquals(validate("referrer", { _email: "a@b.be" }), null);
});

Deno.test("formatFields skips internal and empty", () => {
  assertEquals(formatFields({ _email: "x", Naam: "Jan", Leeg: "", Opties: ["a", "b"] }), "Naam: Jan\nOpties: a, b");
});
