import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the Supabase client: each test sets what the account and office look like.
const state = {
  orgId: "org-1" as string | null,
  isManager: true,
  logo: null as string | null,
  avatar: null as string | null,
  uploads: [] as string[],
  updates: [] as { table: string; values: Record<string, unknown> }[],
};

vi.mock("@/lib/use-org-branding", () => ({ myOrgId: async () => state.orgId }));
vi.mock("@/lib/unit-photos", () => ({ compressImage: async () => new Blob(["x"]) }));
vi.mock("@/lib/avatar", () => ({
  uploadAvatar: async (_c: unknown, uid: string) => {
    state.uploads.push(`avatars/${uid}`);
    return `${uid}/a.jpg`;
  },
}));
vi.mock("@/integrations/supabase/client", () => {
  const select = (table: string) => ({
    eq: () => ({
      maybeSingle: async () => ({
        data: table === "org_settings" ? { logo_url: state.logo } : { avatar_path: state.avatar },
      }),
    }),
  });
  return {
    supabase: {
      rpc: async () => ({ data: state.isManager }),
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string) => {
            state.uploads.push(`${bucket}/${path.split("/")[0]}`);
            return { error: null };
          },
        }),
      },
      from: (table: string) => ({
        select: () => select(table),
        update: (values: Record<string, unknown>) => ({
          eq: () => ({
            is: async () => {
              state.updates.push({ table, values });
              return { error: null };
            },
          }),
        }),
      }),
    },
  };
});

const { fillOfficeLogoIfEmpty, fillAccountPhotoIfEmpty } = await import("./photo-sync");

beforeEach(() => {
  Object.assign(state, {
    orgId: "org-1",
    isManager: true,
    logo: null,
    avatar: null,
    uploads: [],
    updates: [],
  });
});

describe("fillOfficeLogoIfEmpty (after the account photo is saved)", () => {
  it("uses the photo as the office logo when the office has none", async () => {
    expect(await fillOfficeLogoIfEmpty(new Blob(["img"]))).toBe(true);
    expect(state.uploads).toEqual(["branding/org-1"]);
    expect(state.updates[0]?.table).toBe("org_settings");
  });

  it("never replaces an existing logo", async () => {
    state.logo = "org-1/logo.png";
    expect(await fillOfficeLogoIfEmpty(new Blob(["img"]))).toBe(false);
    expect(state.uploads).toEqual([]);
  });

  it("does nothing for staff who aren't the office manager, or accounts with no office", async () => {
    state.isManager = false;
    expect(await fillOfficeLogoIfEmpty(new Blob(["img"]))).toBe(false);
    state.isManager = true;
    state.orgId = null;
    expect(await fillOfficeLogoIfEmpty(new Blob(["img"]))).toBe(false);
    expect(state.uploads).toEqual([]);
  });
});

describe("fillAccountPhotoIfEmpty (after the office logo is saved)", () => {
  it("uses the logo as the account photo when there is none", async () => {
    expect(await fillAccountPhotoIfEmpty(new File(["img"], "logo.png"))).toBe(true);
    expect(state.uploads).toEqual(["avatars/user-1"]);
    expect(state.updates[0]?.table).toBe("profiles");
  });

  it("never replaces an existing account photo", async () => {
    state.avatar = "user-1/me.jpg";
    expect(await fillAccountPhotoIfEmpty(new File(["img"], "logo.png"))).toBe(false);
    expect(state.uploads).toEqual([]);
  });
});
