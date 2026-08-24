/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

/**
 * Shared Ridgeside K9 / RSK9 Insights email branding.
 * Colors mirror the app design tokens in src/index.css.
 */
export const brand = {
  navy: '#142752',
  navyDeep: '#101a2e',
  red: '#c32233',
  gold: '#e2af36',
  cream: '#faf8f4',
  text: '#1c2434',
  muted: '#5e6678',
  border: '#e7e2d9',
  white: '#ffffff',
  radius: '10px',
  font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
}

export const LOGO_URL = 'https://rsk9insights.com/email-logo.png'

export const main = {
  backgroundColor: '#ffffff',
  fontFamily: brand.font,
  margin: '0',
  padding: '0',
}

export const outer = {
  backgroundColor: brand.cream,
  padding: '32px 0',
}

export const container = {
  backgroundColor: brand.white,
  border: `1px solid ${brand.border}`,
  borderRadius: brand.radius,
  maxWidth: '560px',
  margin: '0 auto',
  overflow: 'hidden' as const,
}

export const header = {
  backgroundColor: brand.navy,
  padding: '24px 32px',
  textAlign: 'center' as const,
}

export const content = { padding: '32px' }

export const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: brand.text,
  margin: '0 0 16px',
}

export const text = {
  fontSize: '15px',
  color: brand.muted,
  lineHeight: '1.6',
  margin: '0 0 20px',
}

export const link = { color: brand.navy, textDecoration: 'underline' }

export const button = {
  backgroundColor: brand.navy,
  color: brand.white,
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: brand.radius,
  padding: '13px 26px',
  textDecoration: 'none',
  display: 'inline-block',
}

export const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '26px',
  letterSpacing: '4px',
  fontWeight: 'bold' as const,
  color: brand.navy,
  backgroundColor: brand.cream,
  border: `1px solid ${brand.border}`,
  borderRadius: brand.radius,
  padding: '14px 18px',
  textAlign: 'center' as const,
  margin: '0 0 28px',
}

export const hr = {
  borderColor: brand.border,
  margin: '28px 0 18px',
}

export const footer = {
  fontSize: '12px',
  color: brand.muted,
  lineHeight: '1.6',
  margin: '0',
}

export const goldRule = {
  backgroundColor: brand.gold,
  height: '3px',
  lineHeight: '3px',
  fontSize: '0px',
}

interface LayoutProps {
  preview: string
  siteName: string
  children: React.ReactNode
}

/** Branded wrapper used by every auth email. */
export const Layout = ({ preview, siteName, children }: LayoutProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={main}>
      <Section style={outer}>
        <Container style={container}>
          <Section style={header}>
            <Img
              src={LOGO_URL}
              alt="Ridgeside K9"
              height="44"
              style={{ margin: '0 auto', display: 'block' }}
            />
          </Section>
          <Section style={goldRule}>&nbsp;</Section>
          <Section style={content}>
            {children}
            <Hr style={hr} />
            <Text style={footer}>
              {siteName} — marketing performance reporting for Ridgeside K9.
              This is an automated account message.
            </Text>
          </Section>
        </Container>
      </Section>
    </Body>
  </Html>
)
