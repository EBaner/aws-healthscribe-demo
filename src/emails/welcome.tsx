import * as React from 'react';

import { Body, Button, Container, Head, Hr, Html, Img, Link, Preview, Section, Text } from '@react-email/components';

const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';

interface SummaryEmailProps {
    summary: string;
}

export const SummaryEmail = ({ summary }: SummaryEmailProps) => (
    <Html>
        <Head />
        <Preview>You are now ready to make live transactions with Stripe!</Preview>
        <Body style={main}>
            <Container style={container}>
                <Section style={box}>
                    <Img src={'../../public/AURIBUSICON.png'} width="49" height="21" alt="Stripe" />
                    <Hr style={hr} />
                    <Text style={paragraph}>{summary}</Text>
                    <Text style={paragraph}>
                        You can view your payments and a variety of other information about your account right from your
                        dashboard.
                    </Text>
                    <Hr style={hr} />
                    <Text style={paragraph}>
                        Once you are ready to start accepting payments, you will just need to use your live{' '}
                        <Link style={anchor} href="https://dashboard.stripe.com/login?redirect=%2Fapikeys">
                            API keys
                        </Link>{' '}
                        instead of your test API keys. Your account can simultaneously be used for both test and live
                        requests, so you can continue testing while accepting live payments. Check out our{' '}
                        <Link style={anchor} href="https://stripe.com/docs/dashboard">
                            tutorial about account basics
                        </Link>
                        .
                    </Text>
                    <Text style={paragraph}>
                        Finally, we have put together a{' '}
                        <Link style={anchor} href="https://stripe.com/docs/checklist/website">
                            quick checklist
                        </Link>{' '}
                        to ensure your website conforms to card network standards.
                    </Text>
                    <Hr style={hr} />
                    <Text style={footer}>Auribus Technologies LLC.</Text>
                </Section>
            </Container>
        </Body>
    </Html>
);

export default SummaryEmail;

const main = {
    backgroundColor: '#f6f9fc',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    padding: '20px 0 48px',
    marginBottom: '64px',
};

const box = {
    padding: '0 48px',
};

const hr = {
    borderColor: '#e6ebf1',
    margin: '20px 0',
};

const paragraph = {
    color: '#525f7f',

    fontSize: '16px',
    lineHeight: '24px',
    textAlign: 'left' as const,
};

const anchor = {
    color: '#556cd6',
};

const button = {
    backgroundColor: '#656ee8',
    borderRadius: '5px',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 'bold',
    textDecoration: 'none',
    textAlign: 'center' as const,
    display: 'block',
    width: '100%',
    padding: '10px',
};

const footer = {
    color: '#8898aa',
    fontSize: '12px',
    lineHeight: '16px',
};
