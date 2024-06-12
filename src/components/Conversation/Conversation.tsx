// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import { MedicalScribeJob } from '@aws-sdk/client-transcribe';
import ModalLoader from '@/components/SuspenseLoader/ModalLoader';
import { useAudio } from '@/hooks/useAudio';
import { useNotificationsContext } from '@/store/notifications';
import { IAuraClinicalDocOutput, IAuraTranscriptOutput } from '@/types/HealthScribe';
import { getHealthScribeJob } from '@/utils/HealthScribeApi';
import { getObject, getS3Object } from '@/utils/S3Api';
import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';
import TopPanel from './TopPanel';
import { useAuthContext } from '@/store/auth'; // Import your auth context

const ViewOutput = lazy(() => import('./ViewOutput'));

export default function Conversation() {
    const { conversationName } = useParams();
    const { addFlashMessage } = useNotificationsContext();
    const { isUserAuthenticated, user, signOut } = useAuthContext();// Get the current user

    const [jobLoading, setJobLoading] = useState(true);
    const [jobDetails, setJobDetails] = useState<MedicalScribeJob | null>(null);
    const [showOutputModal, setShowOutputModal] = useState<boolean>(false);
    const [clinicalDocument, setClinicalDocument] = useState<IAuraClinicalDocOutput | null>(null);
    const [transcriptFile, setTranscriptFile] = useState<IAuraTranscriptOutput | null>(null);

    const [
        wavesurfer,
        audioReady,
        setAudioReady,
        audioTime,
        setAudioTime,
        smallTalkCheck,
        setSmallTalkCheck,
        highlightId,
        setHighlightId,
    ] = useAudio();

    useEffect(() => {
        async function getJob(conversationName: string) {
            try {
                setJobLoading(true);
                const getHealthScribeJobRsp = await getHealthScribeJob({ MedicalScribeJobName: conversationName });
                const medicalScribeJob = getHealthScribeJobRsp?.MedicalScribeJob;

                if (!medicalScribeJob) {
                    return;
                }

                // Check if the job has the correct tag
                const userTag = medicalScribeJob.Tags?.find(tag => tag.Key === 'UserName' && tag.Value === user?.username);
                if (!userTag) {
                    setJobDetails(null);
                    setJobLoading(false);
                    return;
                }

                setJobDetails(medicalScribeJob);

                const clinicalDocumentUri = medicalScribeJob.MedicalScribeOutput?.ClinicalDocumentUri;
                const clinicalDocumentRsp = await getObject(getS3Object(clinicalDocumentUri || ''));
                setClinicalDocument(JSON.parse((await clinicalDocumentRsp?.Body?.transformToString()) || ''));

                const transcriptFileUri = medicalScribeJob.MedicalScribeOutput?.TranscriptFileUri;
                const transcriptFileRsp = await getObject(getS3Object(transcriptFileUri || ''));
                setTranscriptFile(JSON.parse((await transcriptFileRsp?.Body?.transformToString()) || ''));
            } catch (e) {
                setJobDetails(null);
                setJobLoading(false);
                addFlashMessage({
                    id: e?.toString() || 'GetHealthScribeJob error',
                    header: 'Conversation Error',
                    content: e?.toString() || 'GetHealthScribeJob error',
                    type: 'error',
                });
            }
            setJobLoading(false);
        }
        if (!conversationName) {
            return;
        } else {
            getJob(conversationName).catch(console.error);
        }
    }, [conversationName, user?.username]);

    return (
        <ContentLayout>
            {showOutputModal && (
                <Suspense fallback={<ModalLoader />}>
                    <ViewOutput
                        setVisible={setShowOutputModal}
                        transcriptString={JSON.stringify(transcriptFile || 'Loading...', null, 2)}
                        clinicalDocumentString={JSON.stringify(clinicalDocument || 'Loading...', null, 2)}
                    />
                </Suspense>
            )}
            <Grid
                gridDefinition={[
                    { colspan: { default: 12 } },
                    { colspan: { default: 6 } },
                    { colspan: { default: 6 } },
                ]}
            >
                <TopPanel
                    jobLoading={jobLoading}
                    jobDetails={jobDetails}
                    transcriptFile={transcriptFile}
                    wavesurfer={wavesurfer}
                    smallTalkCheck={smallTalkCheck}
                    setSmallTalkCheck={setSmallTalkCheck}
                    setAudioTime={setAudioTime}
                    setAudioReady={setAudioReady}
                    setShowOutputModal={setShowOutputModal}
                />
                <LeftPanel
                    jobLoading={jobLoading}
                    transcriptFile={transcriptFile}
                    highlightId={highlightId}
                    setHighlightId={setHighlightId}
                    wavesurfer={wavesurfer}
                    smallTalkCheck={smallTalkCheck}
                    audioTime={audioTime}
                    setAudioTime={setAudioTime}
                    audioReady={audioReady}
                />
                <RightPanel
                    jobLoading={jobLoading}
                    clinicalDocument={clinicalDocument}
                    transcriptFile={transcriptFile}
                    highlightId={highlightId}
                    setHighlightId={setHighlightId}
                    wavesurfer={wavesurfer}
                />
            </Grid>
        </ContentLayout>
    );
}
