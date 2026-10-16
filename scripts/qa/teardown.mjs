// Removes everything setup.mjs created: the QA office, its fixture rows and the 4 QA accounts.
//
//   node scripts/qa/teardown.mjs
//
// Best effort: each step logs and carries on, so a table added later with a foreign key into the
// QA rows shows up as a logged failure instead of stopping the cleanup halfway.
import { rmSync } from "node:fs";
import { CREDS_FILE, ROLES, adminClient, qaCreds } from "./lib.mjs";

const admin = adminClient();
const creds = qaCreds();
const step = async (what, p) => {
  const { error, count } = await p;
  console.log(
    error ? `✗ ${what}: ${error.message}` : `✓ ${what}${count != null ? ` (${count})` : ""}`,
  );
};

const users = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) =>
  ROLES.some((r) => creds[r].email && u.email?.toLowerCase() === creds[r].email.toLowerCase()),
);
const userIds = users.map((u) => u.id);
const office = users.find((u) => u.email === creds.office.email);
const orgId = office
  ? (await admin.from("org_members").select("org_id").eq("user_id", office.id).maybeSingle()).data
      ?.org_id
  : null;

if (orgId) {
  const { data: org } = await admin
    .from("org_settings")
    .select("company_name")
    .eq("id", orgId)
    .single();
  if (!org?.company_name?.startsWith("QA-"))
    throw new Error(`Refusing to delete org ${orgId}: not a QA office`);
  const propIds =
    (await admin.from("properties").select("id").eq("org_id", orgId)).data?.map((x) => x.id) ?? [];
  const unitIds = propIds.length
    ? ((await admin.from("units").select("id").in("property_id", propIds)).data?.map((x) => x.id) ??
      [])
    : [];
  const leaseIds = unitIds.length
    ? ((await admin.from("leases").select("id").in("unit_id", unitIds)).data?.map((x) => x.id) ??
      [])
    : [];
  await step(
    "maintenance_requests",
    admin.from("maintenance_requests").delete({ count: "exact" }).eq("org_id", orgId),
  );
  if (leaseIds.length)
    await step(
      "payments",
      admin.from("payments").delete({ count: "exact" }).in("lease_id", leaseIds),
    );
  if (unitIds.length)
    await step("leases", admin.from("leases").delete({ count: "exact" }).in("unit_id", unitIds));
  if (propIds.length)
    await step("units", admin.from("units").delete({ count: "exact" }).in("property_id", propIds));
  await step("properties", admin.from("properties").delete({ count: "exact" }).eq("org_id", orgId));
  await step("tenants", admin.from("tenants").delete({ count: "exact" }).eq("org_id", orgId));
  await step(
    "org_invitations",
    admin.from("org_invitations").delete({ count: "exact" }).eq("org_id", orgId),
  );
  await step(
    "org_clients",
    admin.from("org_clients").delete({ count: "exact" }).eq("org_id", orgId),
  );
  await step(
    "org_members",
    admin.from("org_members").delete({ count: "exact" }).eq("org_id", orgId),
  );
  await step("org_settings", admin.from("org_settings").delete({ count: "exact" }).eq("id", orgId));
}
const tenant = users.find((u) => u.email === creds.tenant.email);
if (tenant)
  await step(
    "maintenance-media QA photo",
    admin.storage.from("maintenance-media").remove([`${tenant.id}/qa-photo.png`]),
  );
if (userIds.length)
  await step(
    "referral_codes",
    admin.from("referral_codes").delete({ count: "exact" }).in("user_id", userIds),
  );
if (userIds.length)
  await step("profiles", admin.from("profiles").delete({ count: "exact" }).in("id", userIds));
if (userIds.length)
  await step(
    "user_roles",
    admin.from("user_roles").delete({ count: "exact" }).in("user_id", userIds),
  );
for (const u of users) await step(`auth user ${u.email}`, admin.auth.admin.deleteUser(u.id));
rmSync(CREDS_FILE, { force: true });
console.log("done");
