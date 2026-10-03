import * as React from 'react'
import { createAuthEmailHandler } from '@lovable.dev/email-js'
import { createFileRoute } from '@tanstack/react-router'
import { CodeEmail } from '@/lib/email-templates/code-email'
import { InviteEmail } from '@/lib/email-templates/invite'
import { MagicLinkEmail } from '@/lib/email-templates/magic-link'
import { EmailChangeEmail } from '@/lib/email-templates/email-change'
import { ReauthenticationEmail } from '@/lib/email-templates/reauthentication'

// Configuration
const SITE_NAME = "جارك"
const SENDER_DOMAIN = "notify.yourneighbor.app"
const ROOT_DOMAIN = "yourneighbor.app"
const FROM_DOMAIN = "notify.yourneighbor.app"
const SITE_URL = `https://${ROOT_DOMAIN}`

// The SDK handler owns verification, dispatch, and retry semantics; this file
// owns only the email decisions: subjects, templates, and per-type props.
export const Route = createFileRoute("/lovable/email/auth/webhook")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: ({ request }) => {
        const handler = createAuthEmailHandler({
          apiKey: process.env['LOVABLE_API_KEY']!,
          from: `"${SITE_NAME}" <noreply@${FROM_DOMAIN}>`,
          senderDomain: SENDER_DOMAIN,
          sendUrl: process.env['LOVABLE_SEND_URL'],
          emails: {
            signup: {
              subject: 'رمز تفعيل حسابك في جارك',
              render: (data) =>
                React.createElement(CodeEmail, {
                  siteName: SITE_NAME,
                  title: 'فعّل حسابك',
                  intro: 'أهلًا بك في جارك! أدخل هذا الرمز في صفحة التسجيل لتفعيل حسابك:',
                  token: data.token ?? '',
                  footerNote: 'إذا ما سجّلت في جارك، تجاهل هذه الرسالة.',
                }),
            },
            invite: {
              subject: 'دعوة للانضمام إلى جارك',
              render: (data) =>
                React.createElement(InviteEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  confirmationUrl: data.url,
                }),
            },
            magiclink: {
              subject: 'رابط الدخول إلى جارك',
              render: (data) =>
                React.createElement(MagicLinkEmail, {
                  siteName: SITE_NAME,
                  confirmationUrl: data.url,
                }),
            },
            recovery: {
              subject: 'رمز إعادة تعيين كلمة المرور',
              render: (data) =>
                React.createElement(CodeEmail, {
                  siteName: SITE_NAME,
                  title: 'إعادة تعيين كلمة المرور',
                  intro: 'أدخل هذا الرمز في صفحة الدخول لتعيين كلمة مرور جديدة:',
                  token: data.token ?? '',
                  footerNote: 'إذا ما طلبت إعادة التعيين، تجاهل هذه الرسالة وكلمة مرورك تبقى كما هي.',
                }),
            },
            email_change: {
              subject: 'أكّد بريدك الجديد',
              render: (data) =>
                React.createElement(EmailChangeEmail, {
                  siteName: SITE_NAME,
                  oldEmail: data.old_email ?? '',
                  email: data.email,
                  newEmail: data.new_email ?? '',
                  confirmationUrl: data.url,
                }),
            },
            reauthentication: {
              subject: 'رمز التحقق من جارك',
              render: (data) =>
                React.createElement(ReauthenticationEmail, { token: data.token ?? '' }),
            },
          },
        })
        return handler(request)
      },
    },
  },
})
