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
                        Auribus Scribe is a HIPAA-eligible service empowering healthcare software vendors to build
                        clinical applications that automatically generate clinical notes by analyzing patient-clinician
                        conversations.
                    </p>
                    <p>Currently this demo allows you to:</p>
                    <ul>
                        <li>
                            <Link onFollow={() => navigate('/conversations')}>View HealthScribe results</Link>,
                            including:
                        </li>
                        <ul>
                            <li>Summarized clinical notes</li>
                            <li>Rich consultation transcripts</li>
                            <li>Transcript segmentation</li>
                            <li>Evidence mapping</li>
                            <li>Structured medical terms</li>
                        </ul>
                        <li>
                            Integrate HealthScribe output with{' '}
                            <Link external href="https://aws.amazon.com/comprehend/medical/">
                                Amazon Comprehend Medical
                            </Link>
                            , allowing you to:
                            <ul>
                                <li>
                                    Infer medical ontologies (RxNorm, ICD-10-CM, and SNOMED CT) from the HealthScribe
                                    trancript
                                </li>
                                <li>
                                    Detect medical terminologies and infer medical ontologies from the HealthScribe
                                    insights output
                                </li>
                            </ul>
                        </li>
                        <li>
                            <Link onFollow={() => navigate('/new')}>Submit or record your own audio file</Link> to AWS
                            HealthScribe.
                        </li>
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
                    <Link external href="auribustech.com">
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
