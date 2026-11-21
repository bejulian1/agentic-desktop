import assert from "node:assert/strict";
import { test } from "node:test";
import { browserDestination } from "../src/panels/browser-address.ts";

test("adressefeltet skiller nettadresser og prosjektstier fra søkeord", () => {
  for (const address of ["google.com", "localhost:3000", "127.0.0.1:8000/side", "https://eksempel.no/sok?q=hei", "./index.html", "/mappe/side.html", "about:blank", "ftp://eksempel.no/", "file:///en lokal mappe/fil", "./en lokal mappe/side.html"]) {
    assert.equal(browserDestination(` ${address} `), address);
  }
  assert.equal(browserDestination(""), "");
  assert.equal(browserDestination("en lokal prøve", "http://127.0.0.1:9000/sok?q={q}"), "http://127.0.0.1:9000/sok?q=en%20lokal%20pr%C3%B8ve");
  assert.equal(browserDestination("hest"), "https://duckduckgo.com/?q=hest");
});
