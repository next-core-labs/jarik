import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  /** Where the button goes: the Supabase invite link (new account) or the sign-in page. */
  confirmationUrl: string;
  /** The office that sent the invitation, when known. */
  officeName?: string | null;
  /** «مالك» / «مستأجر» / «عضو في فريق المكتب» — what the office invites them as. */
  roleLabel?: string | null;
  /** True for someone who already has an account: they sign in and accept, no password to set. */
  existingAccount?: boolean;
}

/** دعوة مكتب عقاري على جارك — لحساب جديد (يعيّن كلمة مرور) أو لحساب قائم (يدخل ويقبل). */
export const InviteEmail = ({
  siteName,
  confirmationUrl,
  officeName,
  roleLabel,
  existingAccount = false,
}: InviteEmailProps) => {
  const who = officeName ? `مكتب «${officeName}»` : "مكتبك العقاري";
  const as = roleLabel ? ` بصفتك ${roleLabel}` : "";
  return (
    <Html lang="ar" dir="rtl">
      <Head />
      <Preview>{`${who} يدعوك على ${siteName}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brand}>{siteName}</Text>
          <Heading style={h1}>لديك دعوة من {who}</Heading>
          <Text style={text}>
            {existingAccount
              ? `دعاك ${who} للارتباط به${as} على ${siteName}. ادخل بحسابك وستجد الدعوة أعلى لوحتك لتقبلها.`
              : `دعاك ${who} للانضمام إلى ${siteName}${as}. اضغط الزر لتفعيل حسابك وتعيين كلمة مرور.`}
          </Text>
          <Button style={button} href={confirmationUrl}>
            {existingAccount ? "الدخول وقبول الدعوة" : "تفعيل حسابي"}
          </Button>
          <Text style={footer}>إذا لم تكن تتوقع هذه الدعوة، تجاهل هذه الرسالة.</Text>
        </Container>
      </Body>
    </Html>
  );
};

export default InviteEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Tahoma, Arial, sans-serif" };
const container = { padding: "24px 28px", textAlign: "right" as const };
const brand = { fontSize: "18px", fontWeight: "bold", color: "#0f5132", margin: "0 0 16px" };
const h1 = { fontSize: "22px", fontWeight: "bold", color: "#111111", margin: "0 0 16px" };
const text = { fontSize: "15px", color: "#444444", lineHeight: "1.7", margin: "0 0 24px" };
const button = {
  backgroundColor: "#111111",
  color: "#ffffff",
  fontSize: "15px",
  borderRadius: "6px",
  padding: "12px 22px",
  textDecoration: "none",
};
const footer = { fontSize: "12px", color: "#999999", margin: "28px 0 0" };
