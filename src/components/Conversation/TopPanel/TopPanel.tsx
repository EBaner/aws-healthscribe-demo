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
import { getSetSummary } from '../RightPanel/RightPanel';
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

    const [waveformLoaded, setWaveformLoaded] = useState(false);

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

    const worker = useMemo(() => {
        const code = `
            self.onmessage = function(e) {
                const { peaks, duration } = e.data;
                const silenceRegions = extractRegions(peaks, duration);
                const silenceTotal = silenceRegions.reduce((sum, { start, end }) => sum + (end - start), 0);
                const silencePercent = silenceTotal / duration;
                self.postMessage({ silenceRegions, silencePercent });
            };

            function extractRegions(peaks, duration) {
                // Implement your extractRegions logic here
                // This is a placeholder implementation
                return [{start: 0, end: duration / 10}];
            }
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }, []);

    // Download audio from S3 and initialize waveform
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
                        minPxPerSec: 100, // Increase for better performance with long audio
                    });

                    setWavesurferRegions(wavesurfer.current.registerPlugin(RegionsPlugin.create()));
                }

                wavesurfer.current.on('ready', () => {
                    const audioDuration = wavesurfer.current!.getDuration();
                    const peaks = wavesurfer.current!.exportPeaks();

                    // Use Web Worker for heavy computations
                    worker.postMessage({ peaks: peaks[0], duration: audioDuration });

                    setShowControls(true);
                    setAudioLoading(false);
                    setAudioReady(true);
                    setWaveformLoaded(true);
                });

                wavesurfer.current.on('audioprocess', () => {
                    setAudioTime(wavesurfer.current?.getCurrentTime() ?? 0);
                });

                wavesurfer.current.on('seeking', () => {
                    setAudioTime(wavesurfer.current?.getCurrentTime() ?? 0);
                });

                wavesurfer.current.on('finish', () => {
                    setPlayingAudio(false);
                });
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

        return () => {
            worker.terminate();
        };
    }, [jobLoading, waveformElement]);

    useEffect(() => {
        worker.onmessage = (e) => {
            const { silenceRegions, silencePercent } = e.data;
            setSilencePercent(silencePercent);
            // Use silenceRegions as needed
        };
    }, [worker]);

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
        const summaryText = await getSetSummary(jobDetails?.MedicalScribeJobName, selectedOptions);

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
            let jobUrl: string | undefined;
            let fileName: string;
            let fileType: string;
            let content: string | Blob;

            const jobName = jobDetails?.MedicalScribeJobName || 'unnamed_job';
            const safeJobName = jobName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

            switch (detail.id) {
                case 'audio':
                    jobUrl = jobDetails?.Media?.MediaFileUri;
                    fileName = `${safeJobName}_audio.mp3`;
                    fileType = 'audio/mpeg'; // We'll detect the actual type from the response
                    content = new Blob();
                    break;
                case 'transcript':
                    jobUrl = jobDetails?.MedicalScribeOutput?.TranscriptFileUri;
                    fileName = `${safeJobName}_transcript.txt`;
                    fileType = 'text/plain';
                    content = new Blob();
                    break;
                case 'summary':
                    fileName = `${safeJobName}_summary.txt`;
                    fileType = 'text/plain';
                    content = await getSetSummary(jobDetails?.MedicalScribeJobName, selectedOptions);
                    break;
                default:
                    addFlashMessage({
                        id: 'invalid-option',
                        header: 'Invalid Option',
                        content: 'Invalid download option selected.',
                        type: 'error',
                    });
                    return;
            }

            try {
                if (detail.id === 'summary') {
                    const file = new Blob([content], { type: fileType });
                    downloadFile(file, fileName);
                } else if (jobUrl) {
                    const presignedUrl = await getPresignedUrl(getS3Object(jobUrl));
                    await downloadLargeFile(presignedUrl, fileName);
                } else {
                    throw new Error('Job URL is undefined');
                }
            } catch (error) {
                console.error('Download error:', error);
                addFlashMessage({
                    id: 'download-error',
                    header: 'Download Failed',
                    content: `Failed to download ${fileName}. Please try again. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    type: 'error',
                });
            }
        }

        async function downloadLargeFile(fileUrl: string, fileName: string) {
            try {
                const response = await fetch(fileUrl);

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                // Get the content type from the response
                const contentType = response.headers.get('content-type') || 'application/octet-stream';

                // Create a ReadableStream from the response body
                const reader = response.body!.getReader();
                const stream = new ReadableStream({
                    start(controller) {
                        return pump();
                        function pump(): Promise<void> {
                            return reader.read().then(({ done, value }) => {
                                if (done) {
                                    controller.close();
                                    return;
                                }
                                controller.enqueue(value);
                                return pump();
                            });
                        }
                    },
                });

                // Create a new response with the stream
                const newResponse = new Response(stream);

                // Get the blob from the new response
                const blob = await newResponse.blob();

                // Create object URL and trigger download
                const objectUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = objectUrl;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(objectUrl);
                document.body.removeChild(a);
            } catch (error) {
                if (error instanceof Error) {
                    console.error('Download error:', error.message);
                    throw error;
                } else {
                    console.error('An unknown error occurred');
                    throw new Error('An unknown error occurred during download');
                }
            }
        }

        function downloadFile(file: Blob, fileName: string) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(file);
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
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

    // <Button onClick={() => setShowOutputModal(true)}>View HealthScribe Output</Button>
    // Was in between Export and Exit Conversation

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
