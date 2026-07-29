import "../src/loadEnv.js";
import jwt from "jsonwebtoken";
import { readCompanySessionGate } from "../src/master/commercial/companySessionRevocation.js";
import { pool } from "../src/db/index.js";

const companyId = "a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b";
const userId = "dc1c2aad-302e-448b-aa63-8f890d25c95e";
const secret = String(process.env.JWT_SECRET || "").trim();
const gate = await readCompanySessionGate(companyId);
const token = jwt.sign(
  {
    sub: userId,
    userId,
    companyId,
    role: "employee",
    jti: "diag-" + Date.now(),
    companySessionVersion: gate?.companySessionVersion ?? 0,
  },
  secret,
  { expiresIn: "2h" },
);

const me = await fetch("http://localhost:3000/api/auth/me", {
  headers: { Authorization: "Bearer " + token },
});
const meBody = await me.json();
const users = await fetch(
  "http://localhost:3000/api/data/users?filters=" +
    encodeURIComponent(JSON.stringify([
      { column: "company_id", operator: "eq", value: companyId },
      { column: "id", operator: "eq", value: userId },
    ])) +
    "&columns=id%2Cemail&limit=1",
  { headers: { Authorization: "Bearer " + token } },
);
const usersBody = await users.json();
console.log(JSON.stringify({
  nodeEnv: process.env.NODE_ENV,
  gate,
  jwtVersion: gate?.companySessionVersion ?? 0,
  meStatus: me.status,
  meBody,
  usersStatus: users.status,
  usersBody,
}, null, 2));
await pool.end();
