/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'

import { Layout, button, h1, text } from './theme.tsx'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Layout preview={`Your sign-in link for ${siteName}`} siteName={siteName}>
    <Heading style={h1}>Your sign-in link</Heading>
    <Text style={text}>
      Use the button below to sign in to {siteName}. The link expires shortly.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Sign in
    </Button>
    <Text style={{ ...text, margin: '24px 0 0' }}>
      If you didn't request this link, you can safely ignore this email.
    </Text>
  </Layout>
)

export default MagicLinkEmail
