# Prompt for Claude Design — Jark (جارك) full redesign

> Copy everything below the line into Claude Design.

---

## Your task

Design a **completely new visual design** for **Jark (جارك)**, a Saudi real-estate platform. It already exists and works, but **do not recreate or imitate its current look**. Treat this as a fresh product design: new layout system, new navigation model, new components, new typography scale, new illustration/iconography approach. Keep only the brand name, logo, and core brand color (details below).

Start by creating a **design system**. Then design the key screens listed at the end, in that order.

---

## 1. What Jark is

"Jark" (جارك) means **"your neighbor"** in Arabic (domain: yourneighbor.app). The idea: one trusted neighbor who connects everyone in a property's life.

Jark does two jobs on one platform:

1. **A public property marketplace.** Anyone can search homes and commercial units for **rent or sale**, see them on a map, contact the office on WhatsApp or by phone, or post what they're looking for.
2. **A property-management system (SaaS) for real-estate offices**, with connected portals for **owners** and **tenants**. The office manages units, leases, rent collection, invoices, maintenance and deals. The owner sees their income and approves decisions. The tenant pays, requests repairs and renews.

Who it's for: the Saudi market, where many offices still run on WhatsApp and Excel. Jark replaces that with one system that respects Saudi rules (Ejar leases, ZATCA e-invoices, FAL broker license, national ID / Iqama).

**Language:** Arabic first, **RTL-native** (not a mirrored LTR layout). Public pages also have an English toggle (AR/EN). Currency is SAR (ر.س). Times are Riyadh time.

---

## 2. Brand (keep these, redesign everything else)

- Name: **جارك / Jark**
- Logo: red and black wordmark
- Primary brand color: **Jark Red `#EC3013`**. Pair it with black and a warm off-white ("plaster" `#F3F2F2`).
- You may build a new supporting palette (neutrals, success/warning/danger, map colors, chart colors) around these. Red must feel confident and premium, not alarming. Don't use red for both the brand and for errors without making the two clearly different.
- **Light and dark mode** are both required.
- Personality: trustworthy, neighborly, modern Saudi, calm and professional. Not generic Western SaaS and not cluttered classifieds.
- Typography: pick an Arabic-first family with a matching Latin face (for example IBM Plex Sans Arabic, Tajawal, Readex Pro, or similar). Make sure Arabic numerals, prices and tables stay easy to read.

---

## 3. User roles (each has its own experience)

| Role | Who | Where they live |
|---|---|---|
| **Visitor** | Anyone, not logged in | Public marketplace, listing pages, office pages, requests market |
| **Office** (manager / staff / technician) | Real-estate office team | Office dashboard (the main work tool, desktop-heavy) |
| **Owner** | Property owner | Owner portal: income, approvals, portfolio, map |
| **Tenant** | Person renting a unit | Tenant portal: payments, maintenance, contract (mobile-first) |
| **Platform HQ** | Jark's own team (super-admin + delegated admins) | Separate HQ workspace above all offices |

One account can have more than one role (for example an owner who is also a tenant), so design a clear **role switcher**.

---

## 4. Features to design, by area

### 4.1 Public website (visitor)

- **Marketplace home ("سوق العروض")**: a large search hero with filters for location/office, rent | sale | all (with result counts), property type, rooms, furnished, price range (the price scale switches: thousands for rent, millions for sale), and sort. Below it, a grid of listing cards.
- **Property types**: residential (apartment, villa, floor, palace, duplex, studio, residential building, room), commercial (shop, office, showroom, warehouse, factory, commercial building, tower, hotel), land & farms (residential/commercial/agricultural/industrial land, farm), leisure (istiraha, chalet, camp).
- **Listing card**: photo with the office logo on it, "For rent / For sale" badge, price (annual for rent, total for sale), specs (rooms, baths, area, furnished), neighborhood, **distance from me** (new, see section 5), and quick Call / WhatsApp buttons. Include a clean "no photos yet" state.
- **Listing detail page**: full-screen photo gallery, price, specs, description, amenities, property info, an **advertiser card** (office or owner, with FAL license, quality rating badge, Call / WhatsApp / "see all their listings"), a **"Request this unit" form** (rent or buy, optional referral code), a **mortgage calculator** for sale listings (down payment, profit rate, term → estimated monthly payment, with a disclaimer), a **nearby services map**, similar listings, and share. Also show a **price-drop badge** when a vacant unit's automatic price reduction is active.
- **Office public page**: cover, logo, bio, FAL license, verified badge, maintenance quality rating (shown only after 3+ ratings), contact, and all of the office's listings.
- **Owner public page**: photo, bio, areas served, contacts, and their listings.
- **Offices directory**: find verified offices by neighborhood/city. This also needs **"offices near me"**.
- **Requests market ("سوق الطلبات")**: visitors post what they're looking for (no login needed, rate-limited). The public sees open requests from the last 45 days **without name or phone**. Only offices see contact details and can close a request.
- **"For offices" section**: a marketing block that explains the management system and invites offices to register.
- Legal pages, sitemap-friendly structure, and shareable links with rich WhatsApp previews (og image).

### 4.2 Sign up & login

- Choose account type: **Real-estate office / Owner / Tenant**.
- Office: national ID (starts with 1) + **FAL license number**. Owner/tenant: national ID or Iqama (starts with 1 or 2).
- Email activation with a **6-digit code**, resend code, forgot password by code, show/hide password, "remember my email".
- Separate quick entry points: tenant activation link, owner login, Google sign-in.
- **Invitations banner**: when an office invites you (as staff, owner or tenant), you accept or decline from a banner on any page.

### 4.3 Office dashboard (the core product — desktop first, still usable on tablet)

Navigation has about 20 modules. Design a smarter navigation than a long sidebar list: group them, add search / command palette (⌘K), favorites, and badges for counts.

**Overview**
- **KPI dashboard**: occupancy %, vacant units, monthly collected vs due, overdue amount, open maintenance, leases expiring soon, electricity/water consumption from meter readings, and office stamp/logo.
- **Office stats**: occupancy, vacant → deal conversion, **listing performance per unit** (views, call clicks, WhatsApp clicks over 30 days), referrals, staff performance.
- **Occupancy map**: all properties on a map, colored by status (fully occupied / partly vacant / vacant / sold), with popups showing counts.

**Properties & people**
- **Properties & units**: register a unit with full details (neighborhood, street, floor, rooms, halls, baths, furnished, meters, owner, tenant, repair bills, notes), up to 8 photos (reorder, choose cover), listing description & amenities, rent or sale, status (vacant / occupied / sold). Buttons: **"Suggest rent price" (AI, from neighborhood market data)**, **"Ready ad"** (generates a public listing), and an optional **auto price drop** for long-vacant units (with a minimum price floor).
- **Owner pages**: build and publish each owner's public page.
- **Office team**: invite staff and technicians, link owners and tenants, promote or remove.
- **Management agreements**: contracts between the office and owners, with permission scopes (for example leasing).
- **Office identity**: logo, name, FAL license, phone, cover, bio, tax number, commercial registration, office stamp.

**Leasing & money**
- **Tenants & leases**: lease list, term badges (1/3/6/12 months), tenant rating (**on time / late / defaulting**).
- **Renewals**: leases expiring soon, **one-click renewal** (new lease + payment schedule + notification), **bulk renewal** with multi-select and a review step, a dynamic "suggest price from neighborhood market" button, tenant renew-or-leave decisions, and **security deposits** (refund or deduct, notify the tenant).
- **Collections & expenses**: payments due/paid/overdue, an overdue board, automatic reminders (7/3/0 days before due), record a payment (which notifies owner and tenant automatically), expenses by category, Excel export.
- **E-invoices**: ZATCA-compliant invoices with QR code, VAT, tax number, CR, logo; a compliance check before download; electricity/water charges calculated from meters.

**Operations**
- **Maintenance**: requests with photo and voice-note attachments (voice → text), **auto-triage** (keywords such as leak, fire, gas smell → urgent, with an instant WhatsApp alert), **smart scheduling** (assigns the least-loaded technician, with a visit time based on priority), owner approval above a cost limit, and the tenant's rating after the job.
- **Deals (sales & marketing)**: pipeline of deals; vacant units can be converted to deals.
- **Unit requests**: incoming requests from the public, convert to a deal.
- **Documents**: property document archive with **expiry alerts 60 days ahead**.
- **Reports**: monthly PDF report, custom date range, expenses by category, staff performance, **estimated quarterly VAT summary** (clearly labelled as an estimate), and multi-sheet Excel export.
- **Audit log**: who changed what, and when.

**Communication & AI**
- **Messages**: chat per unit between office, owner and tenant, plus direct chat between any two accounts.
- **WhatsApp assistant**: office WhatsApp channel and inbox. It can be locked by HQ, so design a locked state with a banner and disabled actions.
- **Notifications** center.
- **AI assistant**: chat that answers questions about the portfolio (vacancies, overdue, leases) and can create maintenance requests or deals.
- **Unverified office banner**: a new office works internally, but its listings stay hidden until HQ verifies it.

### 4.4 Owner portal

- **Hero**: total income, occupancy, and a **portfolio health score (0–100)** built from occupancy, overdue rent, pending maintenance and expiring leases.
- **Attention center**: things that need the owner now (approvals, overdue rent, expiring leases).
- **Approvals**: approve or reject maintenance above the cost limit, plus an **auto-approve** setting with a threshold.
- **My properties**: portfolio list and cards per unit, with status and every update on each unit.
- **Map & neighborhood**: the owner's properties on a map, with nearby services and a **neighborhood market benchmark** (average rent and occupancy by area).
- **Finance**: collections chart, recent payments, expenses, **income forecast**, and **owner statement PDF**.
- **Vacancies** and **renewals** sections.
- **Yield comparison** between properties.
- **Offices & agreements**: which offices manage what, and link requests.
- **Refer a friend** card with a personal referral code.
- Settings, profile photo, and reference ID.

### 4.5 Tenant portal (mobile-first, very simple)

- **Next payment card**: amount, due date, days left, remaining balance.
- **Report a payment** and get a **PDF receipt**.
- **Payments table** (history).
- **Contract card**: term, dates, unit, office.
- **Quick maintenance**: photo + voice note, then a **tracker** (submitted → scheduled → in progress → done) and a rating at the end.
- **Renew or leave** decision when the lease is ending.
- Updates feed, messages with the office, documents, refer a friend, and settings.

### 4.6 Platform HQ (Jark's internal team — separate workspace)

This must look clearly different from the office dashboard (for example a darker "control room" feel), and it shows only platform navigation.

- **Subscribers**: directory of every account, with role, activity counters and a VIP star; view account details; "log in as this user" (impersonation) with a visible "return to HQ" bar.
- **Overview**: platform growth, offices, units and listings.
- **Offices & marketplace**: verify offices, lock/unlock WhatsApp, feature flags.
- **Accounting**, **site commissions** (manual ledger), **reviews & complaints**, **announcements chat**, **public chat**, **audit log**, **system**.
- **Admins** (super-admin only): invite delegated admins with per-section permissions.

### 4.7 Shared across all dashboards

Help widget at the bottom of every sidebar, feedback widget, account profile card (photo, name, 6-digit reference ID), role switcher, notifications bell, and an invitations banner.

---

## 5. NEW FEATURE: Map + "Near me" (design this in depth)

This doesn't exist yet in a strong form. Make it a **signature feature** of the new design.

### 5.1 "Near me" on the marketplace
- A prominent **"Near me / بالقرب مني"** button in the search hero and in the mobile bottom bar.
- When tapped: ask for location permission (use a friendly pre-permission screen that explains why), then show listings sorted by distance.
- **Split view on desktop**: list on one side, map on the other (RTL-aware: think about which side the map goes on). Hovering a card highlights its pin, and the other way round.
- **Mobile**: full-screen map with a draggable bottom sheet of listing cards, and a toggle between map and list.
- **Radius chips**: 1 km / 3 km / 5 km / 10 km / custom, plus a visible radius circle on the map.
- **Price pins**: pins show the price ("45K", "1.2M"), cluster when zoomed out with a count, and use a different style for rent vs sale.
- **"Search this area"** button after panning the map.
- Every card shows **distance** ("2.3 km away" / "يبعد 2.3 كم") and optionally drive time.
- **Fallback states**: permission denied → choose city/neighborhood manually; location unavailable; no results in radius → suggest widening the radius; slow GPS → loading state.
- **Privacy rule**: listings show an **approximate area** (a soft circle or neighborhood-level pin), never the exact building, until the visitor contacts the office. Design the visual for "approximate location".

### 5.2 Nearby services on a listing
- On the listing page: a map plus categorized nearby places, including **mosques, schools, supermarkets/markets, hospitals & pharmacies, parks, gas stations, restaurants/cafés, malls, metro/bus**.
- Category chips toggle the layers. A list shows name, category icon and distance/walk time.
- A **"Neighborhood score"** summary card (for example family-friendly, walkability, nearest mosque) built from the nearby places.

### 5.3 Other map surfaces
- **Offices near me** in the offices directory.
- **Requests near me** for offices browsing the requests market (approximate areas only).
- **Owner portal map**: their properties plus a neighborhood market overlay (average rent heat or bubbles).
- **Office occupancy map**: properties colored by occupancy status, with filters.
- **Technician route view** (optional idea): today's maintenance visits on a map, in order.

### 5.4 Map styling
Design a **custom map style** that fits the new brand: muted base map, brand-red only for the selected or active item, readable Arabic labels, and a dark-mode map variant. Free OpenStreetMap-based tiles will be used, so keep the style achievable with OSM data.

---

## 6. Design principles

1. **Not the current design.** New structure, new navigation, new components.
2. **RTL-native Arabic first**, with full EN support on public pages. Check that icons with direction (arrows, chevrons, progress) flip correctly.
3. **Public = mobile-first** (most visitors come from WhatsApp links on phones). **Office dashboard = desktop-first**, dense but calm data. **Tenant = phone-only simplicity.** **Owner = clear money story.**
4. **Trust signals everywhere**: verified office badge, FAL license, ratings, ZATCA-compliant invoices, approximate-location privacy.
5. **WhatsApp is the main contact channel** in Saudi Arabia. Make Call / WhatsApp actions feel native and prominent.
6. Every list and data view needs **empty, loading, error and permission-denied states**.
7. Accessible contrast (WCAG AA) in both light and dark mode, and touch targets of 44px or more.
8. Use realistic Saudi sample data: Riyadh neighborhoods (Al Malqa, Al Narjis, Hittin, Al Yasmin, Al Sahafa), Jeddah (Al Rawdah, Al Shati), prices in SAR (for example a 3-bedroom apartment at 55,000 SAR/year, a villa for sale at 2.4M SAR), and Arabic names.

---

## 7. Deliverables, in order

1. **Design system**: color tokens (light/dark), typography (AR + EN), spacing, radius, elevation, icons, buttons, inputs, filters/chips, cards (listing, KPI, stat), tables, badges/status pills (vacant, occupied, sold, overdue, urgent…), tabs, dialogs, bottom sheets, toasts, map pins/clusters/radius, charts style, and empty states.
2. **Marketplace home with "Near me"**: mobile and desktop (map split view).
3. **Listing detail page**: mobile and desktop, including nearby services, the mortgage calculator and the request form.
4. **Office dashboard home (KPIs)** plus the new navigation pattern.
5. **Properties & units** (list + unit edit with photos and AI price suggestion).
6. **Collections & overdue board**.
7. **Maintenance** (board + request detail with voice note and scheduling).
8. **Owner portal home** (health score, attention center, finance, map).
9. **Tenant portal home** (mobile): next payment, quick maintenance, tracker.
10. **Sign up flow** (role choice → ID/FAL → 6-digit code).
11. **HQ workspace home** (subscribers + overview).
12. Office public page, requests market, offices near me.

For each screen, show the default state plus at least one empty or edge state.
