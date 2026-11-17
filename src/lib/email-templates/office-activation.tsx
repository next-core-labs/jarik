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

interface OfficeActivationEmailProps {
  siteName: string;
  siteUrl: string;
  /** العنوان نفسه الذي يراه المكتب في الإشعار الداخلي. */
  title: string;
  /** نصّ التذكير — يأتي من notify_cold_offices فالقناتان تقولان الشيء نفسه. */
  body: string;
  officeName?: string | null;
  /** 1..3 — الثالث هو الأخير، ويُقال ذلك صريحًا. */
  stage: number;
}

/**
 * تذكير تفعيل لمكتب سجّل ولم يُدخل عقاراته. النصّ يأتي من القاعدة (مصدر القرار الوحيد)، وهذا
 * القالب يضع له إطارًا ورابطًا للشاشة المقصودة. لا يُرسَل أكثر من ثلاث مرات لمكتب واحد.
 */
export const OfficeActivationEmail = ({
  siteName,
  siteUrl,
  title,
  body,
  officeName,
  stage,
}: OfficeActivationEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>{title}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>{title}</Heading>
        {officeName ? <Text style={muted}>{`مكتب «${officeName}»`}</Text> : null}
        <Text style={text}>{body}</Text>
        <Button style={button} href={`${siteUrl}/properties`}>
          افتح «الأملاك والوحدات»
        </Button>
        <Text style={muted}>
          {stage >= 3
            ? `هذه آخر رسالة تذكير نرسلها — لن تصلك غيرها. ${siteName}.`
            : `وصلتك هذه الرسالة لأن مكتبك مسجّل في ${siteName} ولم تُكتمل بياناته بعد.`}
        </Text>
      </Container>
    </Body>
  </Html>
);

export default OfficeActivationEmail;

const main: React.CSSProperties = {
  backgroundColor: "#f3f2f2",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Tahoma', 'Arial', sans-serif",
  padding: "24px 0",
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "32px 28px",
  maxWidth: "520px",
  border: "1px solid #e4e1e1",
};

const heading: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: "bold",
  color: "#1c1917",
  margin: "0 0 8px",
};

const text: React.CSSProperties = {
  fontSize: "15px",
  lineHeight: "1.8",
  color: "#44403c",
  margin: "0 0 24px",
};

const muted: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "1.7",
  color: "#78716c",
  margin: "16px 0 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#b4292f",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "bold",
  padding: "12px 24px",
  textDecoration: "none",
  display: "inline-block",
};
