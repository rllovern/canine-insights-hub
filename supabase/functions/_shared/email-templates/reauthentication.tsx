/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Heading, Text } from 'npm:@react-email/components@0.0.22'

import { Layout, codeStyle, h1, text } from './theme.tsx'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Layout preview="Your verification code" siteName="RSK9 Insights">
    <Heading style={h1}>Confirm it's you</Heading>
    <Text style={text}>Use this code to confirm your identity:</Text>
    <Text style={codeStyle}>{token}</Text>
    <Text style={{ ...text, margin: '0' }}>
      The code expires shortly. If you didn't request it, you can safely ignore
      this email.
    </Text>
  </Layout>
)

export default ReauthenticationEmail
