import React, { useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Popover from '@cloudscape-design/components/popover';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TokenGroup from '@cloudscape-design/components/token-group';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Tag } from '@aws-sdk/client-s3/dist-types/models/models_0';
import {
    GetMedicalTranscriptionJobCommand,
    MedicalScribeJobSummary,
    MedicalScribeParticipantRole,
    MedicalTranscriptionJobSummary,
    StartMedicalScribeJobRequest,
} from '@aws-sdk/client-transcribe';
import { VocabularyFilterMethod } from '@aws-sdk/client-transcribe';
import {
    ListMedicalTranscriptionJobsCommand,
    ListMedicalTranscriptionJobsCommandInput,
    TranscribeClient,
} from '@aws-sdk/client-transcribe';
import { Progress } from '@aws-sdk/lib-storage';
import { fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import dayjs from 'dayjs';

import { useS3 } from '@/hooks/useS3';
import { useAuthContext } from '@/store/auth';
import { useNotificationsContext } from '@/store/notifications';
import { getHealthScribeJob, listHealthScribeJobs, startMedicalScribeJob } from '@/utils/HealthScribeApi';
import { multipartUpload } from '@/utils/S3Api';
import { getConfigRegion, getCredentials } from '@/utils/Sdk';
import sleep from '@/utils/sleep';

import amplifyCustom from '../../aws-custom.json';
import Auth from '../Auth';
import AudioRecorder from './AudioRecorder';
import { AudioDropzone } from './Dropzone';
import { AudioDetailSettings, AudioIdentificationType, InputName } from './FormComponents';
import styles from './NewConversation.module.css';
import { verifyJobParams } from './formUtils';
import { getClinicData, updateClinicData } from './s3ClinicManager';
import { AudioDetails, AudioSelection } from './types';

async function getUserAttributes(username: string): Promise<string | null> {
    try {
        const user = await getCurrentUser();
        const attributes = await fetchUserAttributes();
        const clinicAttribute = attributes['custom:Clinic'];
        return clinicAttribute || 'No Clinic Found';
    } catch (error) {
        console.error('Error fetching user attributes: ', error);
        throw error;
    }
}

async function getTranscribeClient() {
    const credentials = await getCredentials();
    return new TranscribeClient({
        region: getConfigRegion(),
        credentials,
    });
}

export default function NewConversation() {
    const { updateProgressBar } = useNotificationsContext();
    const navigate = useNavigate();
    const { user } = useAuthContext(); // Retrieve user info
    const loginId = user?.signInDetails?.loginId || 'No username found'; // Extract login ID
    const [clinicName, setClinicName] = useState<string>('No Clinic found');
    const [userJobCount, setUserJobCount] = useState<number>(0); // Counter state

    useEffect(() => {
        async function fetchClinicName() {
            const name = await getUserAttributes(loginId);
            if (typeof name === 'string') {
                setClinicName(name);
            } else {
                setClinicName('No Clinic found');
            }
        }
        fetchClinicName();
    }, [loginId]);

    const [isSubmitting, setIsSubmitting] = useState<boolean>(false); // is job submitting
    const [formError, setFormError] = useState<string | React.ReactElement[]>('');
    const [jobName, setJobName] = useState<string>(''); // form - job name
    const [audioSelection, setAudioSelection] = useState<AudioSelection>('speakerPartitioning'); // form - audio selection
    // form - audio details
    const [audioDetails, setAudioDetails] = useState<AudioDetails>({
        speakerPartitioning: {
            maxSpeakers: 2,
        },
        channelIdentification: {
            channel1: 'CLINICIAN',
        },
    });
    const [filePath, setFilePath] = useState<File>(); // only one file is allowed from react-dropzone. NOT an array
    const [outputBucket, getUploadMetadata] = useS3(); // outputBucket is the Amplify bucket, and uploadMetadata contains uuid4
    const [submissionMode, setSubmissionMode] = useState<string>('uploadRecording'); // to hide or show the live recorder
    const [recordedAudio, setRecordedAudio] = useState<File | undefined>(); // audio file recorded via live recorder

    // Set array for TokenGroup items
    const fileToken = useMemo(() => {
        if (!filePath) {
            return undefined;
        } else {
            return {
                label: filePath.name,
                description: `Size: ${Number((filePath.size / 1000).toFixed(2)).toLocaleString()} kB`,
            };
        }
    }, [filePath]);

    /**
     * @description Callback function used by the lib-storage SDK Upload function. Updates the progress bar
     *              with the status of the upload
     * @param loaded {number} number of bytes uploaded
     * @param part {number} number of the part that was uploaded
     * @param total {number} total number of bytes to be uploaded
     */
    function s3UploadCallback({ loaded, part, total }: Progress) {
        // Last 1% is for submitting to the HealthScribe API
        const value = Math.round(((loaded || 1) / (total || 100)) * 99);
        const loadedMb = Math.round((loaded || 1) / 1024 / 1024);
        const totalMb = Math.round((total || 1) / 1024 / 1024);
        updateProgressBar({
            id: `New HealthScribe Job: ${jobName.replace(/\s+/g, '_')}`,
            value: value,
            description: `Uploaded part ${part}, ${loadedMb}MB / ${totalMb}MB`,
        });
    }

    /**
     * @description Submit the form to create a new HealthScribe job
     */
    async function submitJob(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');

        try {
            const clinicData = await getClinicData();
            let clinicJobCount = clinicData[clinicName] || 0;

            // Increment job count
            clinicJobCount++;

            // Update clinic data in S3
            await updateClinicData(clinicName, clinicJobCount);
        } catch (error) {
            console.error('Error managing clinic data:', error);
            setFormError('Error managing clinic data. Please try again later.');
        }

        try {
            // Build job params with StartMedicalScribeJob request syntax
            const audioParams =
                audioSelection === 'speakerPartitioning'
                    ? {
                          Settings: {
                              MaxSpeakerLabels: audioDetails.speakerPartitioning.maxSpeakers,
                              ShowSpeakerLabels: true,
                          },
                      }
                    : {
                          ChannelDefinitions: [
                              {
                                  ChannelId: 0,
                                  ParticipantRole: audioDetails.channelIdentification
                                      .channel1 as MedicalScribeParticipantRole,
                              },
                              {
                                  ChannelId: 1,
                                  ParticipantRole:
                                      audioDetails.channelIdentification.channel1 === 'CLINICIAN'
                                          ? 'PATIENT'
                                          : ('CLINICIAN' as MedicalScribeParticipantRole),
                              },
                          ],
                          Settings: {
                              ChannelIdentification: true,
                              VocabularyName: 'CustomVetVocab',
                          },
                      };

            const uploadLocation = getUploadMetadata(jobName.replace(/\s+/g, '_'));
            const s3Location = {
                Bucket: uploadLocation.bucket,
                Key: `${uploadLocation.key}/${(filePath as File).name}`,
            };

            const userNameTag: Tag = {
                Key: 'UserName',
                Value: loginId,
            };

            const jobParams: StartMedicalScribeJobRequest = {
                MedicalScribeJobName: jobName.replace(/\s+/g, '_'),
                DataAccessRoleArn: amplifyCustom.healthScribeServiceRole,
                OutputBucketName: outputBucket,
                Media: {
                    MediaFileUri: `s3://${s3Location.Bucket}/${s3Location.Key}`,
                },
                ...audioParams,
                Tags: [userNameTag],
            };

            const verifyParamResults = verifyJobParams(jobParams);
            if (!verifyParamResults.verified) {
                setFormError(verifyParamResults.message);
                setIsSubmitting(false);
                return;
            }

            // Scroll to top
            window.scrollTo(0, 0);

            // Add initial progress flash message
            updateProgressBar({
                id: `New HealthScribe Job: ${jobName.replace(/\s+/g, '_')}`,
                value: 0,
                description: 'Upload to S3 in progress...',
            });

            try {
                await multipartUpload({
                    ...s3Location,
                    Body: filePath as File,
                    ContentType: filePath?.type,
                    callbackFn: s3UploadCallback,
                });
            } catch (e) {
                updateProgressBar({
                    id: `New HealthScribe Job: ${jobName.replace(/\s+/g, '_')}`,
                    type: 'error',
                    value: 0,
                    description: 'Uploading files to S3 failed',
                    additionalInfo: `Error uploading ${filePath!.name}: ${(e as Error).message}`,
                });
                setIsSubmitting(false);
                throw e;
            }

            try {
                // Increment clinic job count
                const startJob = await startMedicalScribeJob(jobParams);
                if (startJob?.MedicalScribeJob?.MedicalScribeJobStatus) {
                    updateProgressBar({
                        id: `New HealthScribe Job: ${jobName.replace(/\s+/g, '_')}`,
                        type: 'success',
                        value: 100,
                        description: 'HealthScribe job submitted',
                        additionalInfo: `Audio file successfully uploaded to S3 and submitted to HealthScribe at ${dayjs(
                            startJob.MedicalScribeJob.StartTime
                        ).format('MM/DD/YYYY hh:mm A')}. Redirecting to conversation list in 5 seconds.`,
                    });
                    await sleep(5000);
                    navigate('/conversations');
                } else {
                    updateProgressBar({
                        id: `New HealthScribe Job: ${jobName.replace(/\s+/g, '_')}`,
                        type: 'info',
                        value: 100,
                        description: 'Unable to confirm HealthScribe job submission',
                        additionalInfo: `Response from HealthScribe: ${JSON.stringify(startJob)}`,
                    });
                }
            } catch (e) {
                updateProgressBar({
                    id: `New HealthScribe Job: ${jobName.replace(/\s+/g, '_')}`,
                    type: 'error',
                    value: 0,
                    description: 'Submitting job to HealthScribe failed',
                    additionalInfo: (e as Error).message,
                });
            }
        } catch (error) {
            console.error('Error fetching user attributes:', error);
            setFormError('Error fetching user attributes. Please try again later.');
        } finally {
            setIsSubmitting(false);
        }
    }

    useEffect(() => {
        setFilePath(recordedAudio);
    }, [recordedAudio]);

    return (
        <ContentLayout
            header={
                <Header
                    description="Upload your audio file to be processed by AWS HealthScribe"
                    variant="awsui-h1-sticky"
                >
                    New Conversation
                </Header>
            }
        >
            <Container>
                <Box margin={{ bottom: 's' }} color="text-status-success" fontSize="heading-m">
                    Logged in as: {loginId} {/* Display login ID */}
                </Box>
                <form onSubmit={(e) => submitJob(e)}>
                    <Form
                        errorText={formError}
                        actions={
                            <SpaceBetween direction="horizontal" size="xs">
                                {isSubmitting ? (
                                    <Button formAction="submit" variant="primary" disabled={true}>
                                        <Spinner />
                                    </Button>
                                ) : (
                                    <Button formAction="submit" variant="primary" disabled={!filePath}>
                                        Submit
                                    </Button>
                                )}
                            </SpaceBetween>
                        }
                    >
                        <SpaceBetween direction="vertical" size="xl">
                            <InputName jobName={jobName} setJobName={setJobName} />
                            <AudioDetailSettings
                                audioSelection={audioSelection}
                                audioDetails={audioDetails}
                                setAudioDetails={setAudioDetails}
                            />
                            <FormField
                                label={
                                    <SpaceBetween direction="horizontal" size="xs">
                                        <div>Session Recording Type</div>
                                        <Box
                                            display="inline-block"
                                            color="text-status-info"
                                            fontSize="body-s"
                                            fontWeight="bold"
                                        >
                                            <Popover
                                                header="Live Recording"
                                                content="Please position your device or microphone so it can capture all conversation participants."
                                            >
                                                <StatusIndicator type="info">Info</StatusIndicator>
                                            </Popover>
                                        </Box>
                                    </SpaceBetween>
                                }
                            >
                                <SpaceBetween direction="vertical" size="xl">
                                    <div className={styles.submissionModeRadio}>
                                        <RadioGroup
                                            ariaLabel="submissionMode"
                                            onChange={({ detail }) => setSubmissionMode(detail.value)}
                                            value={submissionMode}
                                            items={[
                                                { value: 'uploadRecording', label: 'Upload Recording' },
                                                { value: 'liveRecording', label: 'Live Recording' },
                                            ]}
                                        />
                                    </div>
                                    {submissionMode === 'liveRecording' ? (
                                        <>
                                            <FormField
                                                label="Live Recording"
                                                description="Note: You may only record one live recording at a time."
                                            ></FormField>
                                            <AudioRecorder setRecordedAudio={setRecordedAudio} />
                                        </>
                                    ) : (
                                        <FormField label="Select Files">
                                            <AudioDropzone setFilePath={setFilePath} setFormError={setFormError} />
                                            <TokenGroup
                                                i18nStrings={{
                                                    limitShowFewer: 'Show fewer files',
                                                    limitShowMore: 'Show more files',
                                                }}
                                                onDismiss={() => {
                                                    setFilePath(undefined);
                                                }}
                                                items={fileToken ? [fileToken] : []}
                                                alignment="vertical"
                                                limit={1}
                                            />
                                        </FormField>
                                    )}
                                </SpaceBetween>
                            </FormField>
                        </SpaceBetween>
                    </Form>
                </form>
            </Container>
        </ContentLayout>
    );
}

/* <AudioIdentificationType
        audioSelection={audioSelection}
        setAudioSelection={setAudioSelection}
    />


    Removed from above AudioDetailSettings
*/
