/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'

import { Layout, button, h1, text } from './theme.tsx'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Layout preview={`Reset your ${siteName} password`} siteName={siteName}>
    <Heading style={h1}>Reset your password</Heading>
    <Text style={text}>
      We received a request to reset the password on your {siteName} account.
      Choose a new one below.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Choose a new password
    </Button>
    <Text style={{ ...text, margin: '24px 0 0' }}>
      This link can only be used once. If you didn't request a reset, you can
      safely ignore this email — your password stays the same.
    </Text>
  </Layout>
)

export default RecoveryEmail
