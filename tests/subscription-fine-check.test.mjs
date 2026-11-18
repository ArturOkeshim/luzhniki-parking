import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatRussianPlateInput,
  isRussianPlateValid,
  normalizeRussianPlate,
} from "../app/lib/parking-plate.ts";

test("accepts Russian plates typed with Cyrillic, Latin or mixed lookalike letters", () => {
  for (const value of ["А000АА77", "A000AA77", "a000aa77", "A000АA77", " A-000-AA-77 "]) {
    assert.equal(normalizeRussianPlate(value), "А000АА77");
    assert.equal(formatRussianPlateInput(value), "А000АА77");
    assert.equal(isRussianPlateValid(value), true);
  }
});

test("checks the Russian plate for fines without mutating Bitrix", async () => {
  const [component, route, library] = await Promise.all([
    readFile(new URL("../app/parking-subscription/ParkingSubscription.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/parking-subscription/fines/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/parking-fines.ts", import.meta.url), "utf8"),
  ]);

  assert.match(component, /\/api\/parking-subscription\/fines\?plate=/);
  assert.match(component, /Перейти к оплате штрафов/);
  assert.match(component, /fineCheck\.status === "found"/);
  assert.match(route, /listParkingFinesByPlate\(plate\)/);
  assert.match(route, /items\.filter\(isOutstandingParkingFine\)/);
  assert.doesNotMatch(route, /update|modify|move/i);
  assert.match(library, /crm\.item\.list/);
  assert.doesNotMatch(library, /crm\.item\.update/);
});
