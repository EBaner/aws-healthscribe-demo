// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { memo } from 'react';

import { useNavigate } from 'react-router-dom';

import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import TextContent from '@cloudscape-design/components/text-content';

import { useAuthContext } from '@/store/auth';

function Welcome() {
    const navigate = useNavigate();
    const { isUserAuthenticated } = useAuthContext();

    function Content() {
        if (isUserAuthenticated) {
            return (
                <TextContent>
                    <p>
                        Auribus Scribe is an ambient listening scribe solution for veterinarians powered by AWS
                        HealthScribe. Our software automatically generates transcripts and clinical summaries for your
                        patient visits, empowering veterinarians to focus their time on caring for pets in need.
                    </p>
                    <p>Auribus Scribe Currently Allows you to:</p>
                    <ul>
                        <ul>
                            <li>Upload prior recordings or record visits live</li>
                            <li>View speaker-partitioned transcripts of patient visits</li>
                            <li>View and edit SOAP formatted summaries of patient visits</li>
                            <li>Download the audio, transcript and summary</li>
                            <li>Send customizable discharge notes to patients via email</li>
                        </ul>
                    </ul>
                </TextContent>
            );
        } else {
            return <Alert>Log in for full functionality.</Alert>;
        }
    }

    function Footer() {
        return (
            <Box textAlign="center" color="text-body-secondary" fontSize="body-s">
                <p>Copyright Auribus Technologies LLC. All Rights Reserved.</p>
                <p>
                    Visit us at{' '}
                    <Link external href="https://www.auribustech.com/">
                        auribustech.com
                    </Link>
                </p>
            </Box>
        );
    }

    return (
        <ContentLayout header={<Header variant="h2">Welcome to Auribus Scribe powered by AWS</Header>}>
            <Container footer={<Footer />}>
                <Content />
            </Container>
        </ContentLayout>
    );
}

export default memo(Welcome);
