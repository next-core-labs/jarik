import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/native";

/**
 * Opens a private storage file in a new tab. Call it straight from the click handler: the tab is
 * opened synchronously (Safari on iPhone blocks window.open once an await has run, which is why
 * «فتح الملف» did nothing on phones) and pointed at the signed URL once it is ready.
 */
export async function openStorageFile(
  bucket: string,
  path: string,
  failMessage = "تعذّر فتح الملف",
) {
  if (isNativeApp()) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast.error(failMessage);
      return;
    }
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: data.signedUrl });
    return;
  }

  // No "noopener" here: it makes window.open return null, and the tab must be navigated below.
  const tab = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    tab?.close();
    toast.error(failMessage);
    return;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = data.signedUrl;
  } else {
    // Popups blocked altogether: open the file in this tab instead.
    window.location.assign(data.signedUrl);
  }
}
