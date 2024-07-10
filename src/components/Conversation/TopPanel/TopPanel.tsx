// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { MultiselectProps } from '@cloudscape-design/components';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Multiselect from '@cloudscape-design/components/multiselect';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Textarea from '@cloudscape-design/components/textarea';

import { MedicalScribeJob } from '@aws-sdk/client-transcribe';
import emailjs from 'emailjs-com';
import reduce from 'lodash/reduce';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions';

import { useNotificationsContext } from '@/store/notifications';
import { IAuraClinicalDocOutput } from '@/types/HealthScribe';
import { IAuraTranscriptOutput } from '@/types/HealthScribe';
import { getPresignedUrl, getS3Object } from '@/utils/S3Api';

import AudioControls from '../../Common/AudioControls';
import { getSetSummary, getPlainTextSummary } from '../RightPanel/RightPanel';
import { SmallTalkList } from '../types';
import styles from './TopPanel.module.css';
import { extractRegions } from './extractRegions';

const options: MultiselectProps.Option[] = [
    { value: 'CHIEF_COMPLAINT', label: 'Chief Complaint' },
    { value: 'PAST_FAMILY_HISTORY', label: 'Past Family History' },
    { value: 'PAST_SOCIAL_HISTORY', label: 'Past Social History' },
    { value: 'DIAGNOSTIC_TESTING', label: 'Diagnostic Testing' },
    { value: 'HISTORY_OF_PRESENT_ILLNESS', label: 'History of Present Illness' },
    { value: 'REVIEW_OF_SYSTEMS', label: 'Review of Systems' },
    { value: 'PAST_MEDICAL_HISTORY', label: 'Past Medical History' },
    { value: 'PHYSICAL_EXAMINATION', label: 'Physical Examination' },
    { value: 'ASSESSMENT', label: 'Assessment' },
    { value: 'PLAN', label: 'Plan' },
];

type TopPanelProps = {
    jobLoading: boolean;
    jobDetails: MedicalScribeJob | null;
    transcriptFile: IAuraTranscriptOutput | null;
    wavesurfer: React.MutableRefObject<WaveSurfer | undefined>;
    smallTalkCheck: boolean;
    setSmallTalkCheck: React.Dispatch<React.SetStateAction<boolean>>;
    setAudioTime: React.Dispatch<React.SetStateAction<number>>;
    setAudioReady: React.Dispatch<React.SetStateAction<boolean>>;
    setShowOutputModal: React.Dispatch<React.SetStateAction<boolean>>;
    clinicalDocument: IAuraClinicalDocOutput | null;
};

export default function TopPanel({
    jobLoading,
    jobDetails,
    transcriptFile,
    wavesurfer,
    smallTalkCheck,
    setSmallTalkCheck,
    setAudioTime,
    setAudioReady,
    setShowOutputModal,
    clinicalDocument,
}: TopPanelProps) {
    const navigate = useNavigate();
    const { addFlashMessage } = useNotificationsContext();
    const [wavesurferRegions, setWavesurferRegions] = useState<RegionsPlugin>();
    const [audioLoading, setAudioLoading] = useState<boolean>(true);
    const [showControls, setShowControls] = useState<boolean>(false);
    const [playingAudio, setPlayingAudio] = useState<boolean>(false);
    const [playBackSpeed, setPlayBackSpeed] = useState<number>(1);
    const [silenceChecked, setSilenceChecked] = useState<boolean>(false);
    const [silencePeaks, setSilencePeaks] = useState<number[]>([]);
    const [silencePercent, setSilencePercent] = useState<number>(0);
    const [smallTalkPercent, setSmallTalkPercent] = useState<number>(0);
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [exportModalVisible, setExportModalVisible] = useState<boolean>(false);
    const [selectedOptions, setSelectedOptions] = useState<MultiselectProps.Option[]>(options);

    const waveformElement = document.getElementById('waveform');

    // Get small talk from HealthScribe transcript
    const smallTalkList: SmallTalkList = useMemo(() => {
        if (!transcriptFile) return [];
        const transcriptSegments = transcriptFile!.Conversation.TranscriptSegments;
        if (transcriptSegments.length > 0) {
            const stList = [];
            for (const { SectionDetails, BeginAudioTime, EndAudioTime } of transcriptSegments) {
                if (['OTHER', 'SMALL_TALK'].includes(SectionDetails.SectionName)) {
                    stList.push({ BeginAudioTime, EndAudioTime });
                }
            }
            return stList;
        } else {
            return [];
        }
    }, [transcriptFile]);

    // Download audio from S3 and initialize waveform
    useEffect(() => {
        async function getAudio() {
            try {
                if (!jobDetails?.Media?.MediaFileUri) {
                    throw Error('Unable to find HealthScribe audio URL');
                }
                const s3Object = getS3Object(jobDetails?.Media?.MediaFileUri);
                const s3PresignedUrl = await getPresignedUrl(s3Object);

                // Initialize Wavesurfer with presigned S3 URL
                if (!wavesurfer.current) {
                    wavesurfer.current = WaveSurfer.create({
                        backend: 'MediaElement',
                        container: waveformElement || '#waveform',
                        height: 40,
                        normalize: false,
                        waveColor: 'rgba(35, 47, 62, 0.8)',
                        progressColor: '#2074d5',
                        url: s3PresignedUrl,
                    });

                    setWavesurferRegions(wavesurfer.current.registerPlugin(RegionsPlugin.create()));
                }
                // Disable spinner when Wavesurfer is ready
                wavesurfer.current.on('ready', () => {
                    const audioDuration = wavesurfer.current!.getDuration();
                    // Manage silences
                    const sPeaks = wavesurfer.current!.exportPeaks();
                    const silenceTotal = reduce(
                        extractRegions(sPeaks[0], audioDuration),
                        (sum, { start, end }) => {
                            return sum + end - start;
                        },
                        0
                    );
                    setSilencePeaks(sPeaks[0]);
                    setSilencePercent(silenceTotal / audioDuration);

                    // Manage smalltalk
                    const timeSmallTalk = reduce(
                        smallTalkList,
                        (sum, { EndAudioTime, BeginAudioTime }) => {
                            return sum + (EndAudioTime - BeginAudioTime);
                        },
                        0
                    );
                    setSmallTalkPercent(timeSmallTalk / audioDuration);

                    setShowControls(true);
                    setAudioLoading(false);
                    setAudioReady(true);
                });

                // Do not loop around
                wavesurfer.current?.on('finish', () => {
                    setPlayingAudio(!!wavesurfer.current?.isPlaying());
                });

                const updateTimer = () => {
                    setAudioTime(wavesurfer.current?.getCurrentTime() ?? 0);
                };

                wavesurfer.current?.on('audioprocess', updateTimer);
                // Need to watch for seek in addition to audioprocess as audioprocess doesn't fire if the audio is paused.
                wavesurfer.current?.on('seeking', updateTimer);
            } catch (e) {
                setAudioLoading(false);
                addFlashMessage({
                    id: e?.toString() || 'GetHealthScribeJob error',
                    header: 'Conversation Error',
                    content: e?.toString() || 'GetHealthScribeJob error',
                    type: 'error',
                });
            }
        }

        if (!jobLoading && waveformElement) getAudio().catch(console.error);
    }, [jobLoading, waveformElement]);

    // Draw regions on the audio player for small talk and silences
    useEffect(() => {
        if (!wavesurfer.current || !wavesurferRegions) return;
        wavesurferRegions.clearRegions();
        if (smallTalkCheck) {
            for (const { BeginAudioTime, EndAudioTime } of smallTalkList) {
                wavesurferRegions.addRegion({
                    id: `${BeginAudioTime}-${EndAudioTime}-smalltalk`,
                    start: BeginAudioTime,
                    end: EndAudioTime,
                    drag: false,
                    resize: false,
                    color: 'rgba(255, 153, 0, 0.5)',
                });
            }
        }
        if (silenceChecked) {
            for (const { start, end } of extractRegions(silencePeaks, wavesurfer.current.getDuration())) {
                wavesurferRegions.addRegion({
                    id: `${start}-${end}-silence`,
                    start: start,
                    end: end,
                    drag: false,
                    resize: false,
                    color: 'rgba(255, 153, 0, 0.5)',
                });
            }
        }

        // Skip to the end of the region when playing. I.e. skip small talk and silences
        wavesurferRegions!.on('region-in', ({ end }) => {
            if (wavesurfer.current!.getCurrentTime() < end) {
                wavesurfer.current?.seekTo(end / wavesurfer.current?.getDuration());
            }
        });
    }, [wavesurfer, smallTalkCheck, smallTalkList, silenceChecked, silencePeaks]);

    const handleExport = async () => {
        const serviceID = 'service_krsa45w';
        const templateID = 'template_j9sffks';
        const publicKey = 'XTCBlgLBoDDdJiBe7';
        const summaryText = getSetSummary(clinicalDocument, selectedOptions);

        const templateParams = {
            to_email: email,
            subject: 'VetScribe Visit Summary',
            summary: summaryText,
            message: message,
        };

        try {
            await emailjs.send(serviceID, templateID, templateParams, publicKey);
            addFlashMessage({
                id: 'export-success',
                header: 'Export Successful',
                content: `Transcript sent to ${email}`,
                type: 'success',
            });
        } catch (error) {
            addFlashMessage({
                id: 'export-failure',
                header: 'Export Failed',
                content: `Transcript did not send to ${email}. Message: ${error}`,
                type: 'error',
            });
        }

        setExportModalVisible(false);
        setEmail('');
    };

    function AudioHeader() {
        async function openUrl(detail: { id: string }) {
            let jobUrl: string = '';
            if (detail.id === 'audio') {
                jobUrl = jobDetails?.Media?.MediaFileUri as string;
            } else if (detail.id === 'transcript') {
                jobUrl = jobDetails?.MedicalScribeOutput?.TranscriptFileUri as string;
            } else if (detail.id === 'summary') {
                jobUrl = jobDetails?.MedicalScribeOutput?.ClinicalDocumentUri as string;
            }
            if (jobUrl) {
                const presignedUrl = await getPresignedUrl(getS3Object(jobUrl));
                window.open(presignedUrl, '_blank');
            }
        }

        return (
            <Header
                variant="h3"
                actions={
                    <SpaceBetween direction="horizontal" size="xs">
                        <ButtonDropdown
                            items={[
                                { text: 'Audio', id: 'audio' },
                                { text: 'Transcript', id: 'transcript' },
                                { text: 'Summary', id: 'summary' },
                            ]}
                            onItemClick={({ detail }) => openUrl(detail)}
                        >
                            Download
                        </ButtonDropdown>
                        <Button onClick={() => setExportModalVisible(true)}>Export</Button>
                        <Button onClick={() => setShowOutputModal(true)}>View HealthScribe Output</Button>
                        <Button variant="primary" onClick={() => navigate('/conversations')}>
                            Exit Conversation
                        </Button>
                    </SpaceBetween>
                }
            >
                {jobDetails?.MedicalScribeJobName}
            </Header>
        );
    }

    function Loading() {
        return (
            <div
                style={{
                    flex: 'display',
                    textAlign: 'center',
                    paddingTop: '30px',
                    paddingBottom: '30px',
                    color: 'var(--color-text-status-inactive-5ei55p, #5f6b7a)',
                }}
            >
                <Box>
                    <Spinner /> Loading Audio
                </Box>
            </div>
        );
    }

    function SegmentControls() {
        if (!jobLoading && !audioLoading) {
            return (
                <SpaceBetween size={'xl'} direction="horizontal">
                    <Box>
                        <SpaceBetween size={'s'} direction="horizontal">
                            <div className={styles.alignment}>
                                <Box variant="awsui-key-label">Remove</Box>
                            </div>
                            <div className={styles.alignment}>
                                <Checkbox checked={smallTalkCheck} onChange={() => setSmallTalkCheck(!smallTalkCheck)}>
                                    Small Talk (<i>{Math.ceil(smallTalkPercent * 100)}%</i>)
                                </Checkbox>
                            </div>
                            <div className={styles.alignment}>
                                <Checkbox checked={silenceChecked} onChange={() => setSilenceChecked(!silenceChecked)}>
                                    Silences (<i>{Math.ceil(silencePercent * 100)}%</i>)
                                </Checkbox>
                            </div>
                        </SpaceBetween>
                    </Box>
                </SpaceBetween>
            );
        }
    }

    return (
        <>
            <AudioControls
                wavesurfer={wavesurfer}
                audioLoading={audioLoading}
                showControls={showControls}
                setShowControls={setShowControls}
                playingAudio={playingAudio}
                setPlayingAudio={setPlayingAudio}
                playBackSpeed={playBackSpeed}
                setPlayBackSpeed={setPlayBackSpeed}
            />
            <Container header={<AudioHeader />}>
                {(jobLoading || audioLoading) && <Loading />}
                <SegmentControls />
                <div style={{ height: audioLoading ? 0 : '' }}>
                    <div
                        id="waveform"
                        style={{
                            marginTop: '5px',
                            height: audioLoading ? 0 : '',
                        }}
                    />
                </div>
            </Container>
            <Modal
                visible={exportModalVisible}
                onDismiss={() => setExportModalVisible(false)}
                header="Export Transcript"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => setExportModalVisible(false)}>
                                Cancel
                            </Button>
                            <Button variant="primary" onClick={handleExport}>
                                Send
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <FormField label="Email address">
                    <Input
                        type="email"
                        value={email}
                        placeholder="example@email.com"
                        onChange={({ detail }) => setEmail(detail.value)}
                    />
                </FormField>
                <FormField label="Message">
                    <Textarea
                        value={message}
                        placeholder="Enter a message to the client (Optional)"
                        onChange={({ detail }) => setMessage(detail.value)}
                    />
                </FormField>
                <br />
                <Multiselect
                    selectedOptions={selectedOptions}
                    onChange={({ detail }) => setSelectedOptions([...detail.selectedOptions])}
                    options={options}
                    keepOpen={false}
                    placeholder="Please deselect any insights you do not want to include"
                />
            </Modal>
        </>
    );
}
