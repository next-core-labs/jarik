import * as React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'

interface CodeEmailProps {
  siteName: string
  title: string
  intro: string
  token: string
  footerNote: string
}

/** رسالة رمز من 6 أرقام بهوية جارك — صفحات الدخول تنتظر الرمز لا الرابط. */
export const CodeEmail = ({ siteName, title, intro, token, footerNote }: CodeEmailProps) => (
  <Html lang="ar" dir="rtl">
    <Head />
    <Preview>{`${title} — ${siteName}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{siteName}</Text>
        <Heading style={h1}>{title}</Heading>
        <Text style={text}>{intro}</Text>
        <Text style={code}>{token}</Text>
        <Text style={footer}>{footerNote}</Text>
      </Container>
    </Body>
  </Html>
)

const main = { backgroundColor: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif' }
const container = { padding: '24px 28px', textAlign: 'right' as const }
const brand = { fontSize: '18px', fontWeight: 'bold', color: '#0f5132', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#111111', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#444444', lineHeight: '1.7', margin: '0 0 20px' }
const code = {
  fontSize: '32px',
  fontWeight: 'bold',
  letterSpacing: '8px',
  color: '#0f5132',
  backgroundColor: '#eef6f1',
  padding: '14px 0',
  textAlign: 'center' as const,
  direction: 'ltr' as const,
  margin: '0 0 24px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
