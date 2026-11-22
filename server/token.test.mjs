import assert from "node:assert/strict";
import { test } from "node:test";
import { pickToken } from "./token.ts";

const hash = (token) => `hash-${token}`;

test("pickToken uses the first token for no pick and never stands in another workspace's token", () => {
  assert.equal(pickToken(["a", "b"], null, hash), "a");
  assert.equal(pickToken(["a", "b"], "hash-b", hash), "b");
  assert.equal(pickToken(["a", "b"], "hash-gone", hash), undefined);
  assert.equal(pickToken([], null, hash), undefined);
});
