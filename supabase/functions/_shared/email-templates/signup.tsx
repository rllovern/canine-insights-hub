/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'

import { Layout, button, h1, link, text } from './theme.tsx'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Layout preview={`Confirm your email for ${siteName}`} siteName={siteName}>
    <Heading style={h1}>Confirm your email</Heading>
    <Text style={text}>
      Confirm{' '}
      <Link href={`mailto:${recipient}`} style={link}>
        {recipient}
      </Link>{' '}
      to finish setting up your {siteName} account.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Confirm email
    </Button>
    <Text style={{ ...text, margin: '24px 0 0' }}>
      If you didn't create an account, you can safely ignore this email.
    </Text>
  </Layout>
)

export default SignupEmail
