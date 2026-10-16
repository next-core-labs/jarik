// Creates (or repairs) the QA fixture on the live Supabase project. Idempotent — safe to re-run.
//
//   node scripts/qa/setup.mjs
//
// - 4 pre-confirmed accounts: office manager, property owner, tenant, maintenance technician
// - one private QA office (listed_publicly = false) that links all four through the real
//   invitation RPCs
// - a minimal private portfolio: 1 property, 1 occupied unit + 1 vacant unit (neither market-listed),
//   1 active lease with paid / overdue / 2 upcoming payments, 2 maintenance jobs for the technician
//   (one in progress, one done so the tenant rating flow can be tested)
//
// Every row is prefixed "QA-" and lives only inside the QA office. Remove everything with teardown.mjs.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { CREDS_FILE, ROLES, adminClient, qaCreds, signIn } from "./lib.mjs";

const OFFICE_NAME = "QA-Jarak Test Office";
const META = {
  office: { full_name: "QA Office Manager", account_type: "office" },
  owner: { full_name: "QA Owner", account_type: "owner" },
  tenant: { full_name: "QA Tenant", account_type: "tenant" },
  technician: { full_name: "QA Technician", account_type: "tenant" },
};
const WANTED_ROLES = {
  office: ["staff"],
  owner: ["owner"],
  tenant: ["tenant"],
  technician: ["technician"],
};

const admin = adminClient();
const log = (...a) => console.log("•", ...a);
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
const iso = (d) => d.toISOString().slice(0, 10);
const addMonths = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
};

// 1. Credentials — reuse existing ones so re-runs don't rotate passwords.
const existing = qaCreds();
const creds = Object.fromEntries(
  ROLES.map((r) => [
    r,
    {
      email: existing[r].email ?? `qa-${r}@example.com`,
      password: existing[r].password ?? `Qa!${randomBytes(12).toString("base64url")}`,
    },
  ]),
);
writeFileSync(
  CREDS_FILE,
  "# QA accounts on the live Supabase project — written by scripts/qa/setup.mjs. Git-ignored.\n" +
    ROLES.map(
      (r) =>
        `QA_${r.toUpperCase()}_EMAIL=${creds[r].email}\nQA_${r.toUpperCase()}_PASSWORD=${creds[r].password}`,
    ).join("\n") +
    "\n",
);

// 2. Users (pre-confirmed through the admin API; signup email confirmation is on for real users).
const allUsers = must(await admin.auth.admin.listUsers({ perPage: 1000 }), "list users").users;
const ids = {};
for (const r of ROLES) {
  const found = allUsers.find((u) => u.email?.toLowerCase() === creds[r].email.toLowerCase());
  if (found) {
    ids[r] = found.id;
    must(
      await admin.auth.admin.updateUserById(found.id, {
        password: creds[r].password,
        email_confirm: true,
      }),
      `update ${r}`,
    );
    log(`${r}: exists (${creds[r].email})`);
  } else {
    const u = must(
      await admin.auth.admin.createUser({
        email: creds[r].email,
        password: creds[r].password,
        email_confirm: true,
        user_metadata: { ...META[r], phone: "0500000000" },
      }),
      `create ${r}`,
    );
    ids[r] = u.user.id;
    log(`${r}: created (${creds[r].email})`);
  }
}

// 3. Office — through register_office as the office user, falling back to direct inserts if
//    new-office registration is switched off platform-wide.
let orgId = must(
  await admin.from("org_members").select("org_id").eq("user_id", ids.office).maybeSingle(),
  "find org",
)?.org_id;
if (!orgId) {
  const { client } = await signIn("office");
  const res = await client.rpc("register_office", {
    _name: OFFICE_NAME,
    _city: "الرياض",
    _district: "QA-حي الاختبار",
    _fal: "1100000000",
    _phone: "0500000000",
  });
  if (res.error) {
    log(`register_office refused (${res.error.message}) — inserting directly`);
    orgId = must(
      await admin
        .from("org_settings")
        .insert({
          company_name: OFFICE_NAME,
          city: "الرياض",
          office_code: `QA${Date.now() % 100000}`,
          listed_publicly: false,
          verified: false,
        })
        .select("id")
        .single(),
      "insert office",
    ).id;
    must(
      await admin.from("org_members").insert({
        org_id: orgId,
        user_id: ids.office,
        kind: "member",
        role: "staff",
        is_manager: true,
      }),
      "office membership",
    );
  } else {
    orgId = res.data;
  }
  log(`office: registered ${orgId}`);
} else {
  log(`office: exists ${orgId}`);
}
// Never let the QA office reach the public directory, sitemap or marketplace.
must(
  await admin.from("org_settings").update({ listed_publicly: false }).eq("id", orgId),
  "hide office",
);

// 4. Link owner + tenant as clients and the technician as a team member, via the real invite flow.
const { client: officeClient } = await signIn("office");
const isLinked = async (r) => {
  if (r === "technician")
    return !!must(
      await admin.from("org_members").select("org_id").eq("user_id", ids[r]).maybeSingle(),
      "m",
    )?.org_id;
  return !!must(
    await admin
      .from("org_clients")
      .select("org_id")
      .eq("user_id", ids[r])
      .eq("org_id", orgId)
      .maybeSingle(),
    "c",
  )?.org_id;
};
for (const r of ["owner", "tenant", "technician"]) {
  if (await isLinked(r)) {
    log(`${r}: already linked to the office`);
    continue;
  }
  const inv =
    r === "technician"
      ? await officeClient.rpc("office_add_member", {
          _email: creds[r].email,
          _role: "technician",
          _manager: false,
        })
      : await officeClient.rpc("office_link_client", { _email: creds[r].email, _kind: r });
  if (inv.error && !/موجود|exists|pending|بالفعل/i.test(inv.error.message))
    throw new Error(`invite ${r}: ${inv.error.message}`);
  const { client } = await signIn(r);
  const mine = must(await client.rpc("my_invitations"), `my_invitations ${r}`) ?? [];
  for (const i of mine) must(await client.rpc("accept_invitation", { _id: i.id }), `accept ${r}`);
  log(`${r}: invited + accepted (${mine.length} invitation(s))`);
}

// 5. Exact role sets (the signup trigger hands non-office signups a tenant role by default).
for (const r of ROLES) {
  const have = must(
    await admin.from("user_roles").select("role").eq("user_id", ids[r]),
    "roles",
  ).map((x) => x.role);
  for (const role of WANTED_ROLES[r].filter((x) => !have.includes(x)))
    must(await admin.from("user_roles").insert({ user_id: ids[r], role }), `grant ${role}`);
  for (const role of have.filter((x) => !WANTED_ROLES[r].includes(x)))
    must(
      await admin.from("user_roles").delete().eq("user_id", ids[r]).eq("role", role),
      `revoke ${role}`,
    );
}
log("roles: office=staff(manager) owner=owner tenant=tenant technician=technician");

// 6. Portfolio fixture.
const one = async (table, match, insert) => {
  let q = admin.from(table).select("id");
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const found = must(await q.limit(1).maybeSingle(), `find ${table}`);
  if (found) return found.id;
  return must(
    await admin
      .from(table)
      .insert({ ...match, ...insert })
      .select("id")
      .single(),
    `insert ${table}`,
  ).id;
};

const tenantRowId = await one(
  "tenants",
  { org_id: orgId, user_id: ids.tenant },
  {
    full_name: "QA Tenant",
    email: creds.tenant.email,
    phone: "0500000000",
    national_id: "1000000000",
  },
);
const propertyId = await one(
  "properties",
  { org_id: orgId, name: "QA-Building A" },
  {
    owner_id: ids.owner,
    owner_name: "QA Owner",
    city: "الرياض",
    district: "QA-حي الاختبار",
    address: "QA test address",
    property_type: "residential_building",
    lat: 24.7136,
    lng: 46.6753,
  },
);
const occupiedUnit = await one(
  "units",
  { property_id: propertyId, unit_number: "QA-101" },
  {
    owner_id: ids.owner,
    annual_rent: 36000,
    status: "occupied",
    rooms: 3,
    bathrooms: 2,
    area: 120,
    market_listed: false,
  },
);
await one(
  "units",
  { property_id: propertyId, unit_number: "QA-102" },
  {
    owner_id: ids.owner,
    annual_rent: 30000,
    status: "vacant",
    rooms: 2,
    bathrooms: 1,
    area: 90,
    market_listed: false,
    vacant_since: iso(addMonths(-1)),
  },
);
const leaseId = await one(
  "leases",
  { unit_id: occupiedUnit, tenant_id: tenantRowId },
  {
    start_date: iso(addMonths(-6)),
    end_date: iso(addMonths(6)),
    annual_rent: 36000,
    installments: 4,
    term_months: 12,
    status: "active",
    deposit: 2000,
  },
);
const payments = [
  {
    due_date: iso(addMonths(-6)),
    status: "paid",
    paid_date: iso(addMonths(-6)),
    method: "transfer",
  },
  { due_date: iso(addMonths(-1)), status: "overdue" },
  { due_date: iso(addMonths(2)), status: "due" },
  { due_date: iso(addMonths(5)), status: "due" },
];
for (const p of payments)
  await one("payments", { lease_id: leaseId, due_date: p.due_date }, { amount: 9000, ...p });
await one(
  "maintenance_requests",
  { org_id: orgId, title: "QA-تسريب في المطبخ" },
  {
    unit_id: occupiedUnit,
    tenant_id: tenantRowId,
    technician_id: ids.technician,
    status: "in_progress",
    priority: "medium",
    description: "QA fixture — do not action",
    source: "tenant",
  },
);
// A 1×1 photo on the open job, uploaded to the tenant's folder like quick-maintenance does, so
// the technician's "صورة الطلب" button and its storage policy can be tested.
const photoPath = `${ids.tenant}/qa-photo.png`;
must(
  await admin.storage
    .from("maintenance-media")
    .upload(
      photoPath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      { contentType: "image/png", upsert: true },
    ),
  "upload QA photo",
);
must(
  await admin
    .from("maintenance_requests")
    .update({ photo_path: photoPath })
    .eq("org_id", orgId)
    .eq("title", "QA-تسريب في المطبخ"),
  "attach QA photo",
);

// A finished job so the tenant's rating flow can be exercised.
await one(
  "maintenance_requests",
  { org_id: orgId, title: "QA-تبديل إنارة الصالة" },
  {
    unit_id: occupiedUnit,
    tenant_id: tenantRowId,
    technician_id: ids.technician,
    status: "done",
    priority: "low",
    description: "QA fixture — finished job",
    source: "tenant",
  },
);
log(
  `fixture: property ${propertyId}, units QA-101 (leased) + QA-102 (vacant), lease ${leaseId}, 4 payments, 2 maintenance jobs (in progress + done)`,
);

must(
  await admin
    .from("payments")
    .update({ status: "due" })
    .eq("lease_id", leaseId)
    .eq("status", "pending"),
  "fix payment status",
);
must(
  await admin
    .from("maintenance_requests")
    .update({ priority: "medium" })
    .eq("org_id", orgId)
    .eq("priority", "normal"),
  "fix priority",
);

// 7. Every account must sign in. Also create each account's referral and reference codes here:
//    those RPCs insert them lazily on first read, and the write guard lets them through as reads.
for (const r of ROLES) {
  const { client } = await signIn(r);
  must(await client.rpc("my_referral_code"), `referral code ${r}`);
  must(await client.rpc("my_reference_code"), `reference code ${r}`);
}
log(`all 4 accounts sign in — credentials in ${CREDS_FILE}`);
