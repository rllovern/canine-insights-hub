/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'

import { Layout, button, h1, text } from './theme.tsx'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, confirmationUrl }: InviteEmailProps) => (
  <Layout preview={`Your ${siteName} account is ready`} siteName={siteName}>
    <Heading style={h1}>Welcome to {siteName}</Heading>
    <Text style={text}>
      An account has been created for you on {siteName}, the Ridgeside K9
      marketing dashboard — leads, calls, spend, and sales for your location, in
      one place.
    </Text>
    <Text style={text}>
      Set a password to finish setting up your account:
    </Text>
    <Button style={button} href={confirmationUrl}>
      Set your password
    </Button>
    <Text style={{ ...text, margin: '24px 0 0' }}>
      This link can only be used once. If you weren't expecting it, you can
      safely ignore this email.
    </Text>
  </Layout>
)

export default InviteEmail
