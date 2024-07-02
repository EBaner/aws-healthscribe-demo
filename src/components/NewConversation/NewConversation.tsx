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

import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {
    CopyObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    ListObjectsV2Output,
    S3Client,
    _Object,
} from '@aws-sdk/client-s3';
import { Tag } from '@aws-sdk/client-s3/dist-types/models/models_0';
import { MedicalScribeParticipantRole, StartMedicalScribeJobRequest } from '@aws-sdk/client-transcribe';
import { Progress } from '@aws-sdk/lib-storage';
import { Amplify } from 'aws-amplify';
import { fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import dayjs from 'dayjs';

import { useS3 } from '@/hooks/useS3';
import { AuthContext, useAuthContext } from '@/store/auth';
import { useNotificationsContext } from '@/store/notifications';
import { startMedicalScribeJob } from '@/utils/HealthScribeApi';
import { multipartUpload } from '@/utils/S3Api';
import sleep from '@/utils/sleep';

import amplifyCustom from '../../aws-custom.json';
import AudioRecorder from './AudioRecorder';
import { AudioDropzone } from './Dropzone';
import { AudioDetailSettings, AudioIdentificationType, InputName } from './FormComponents';
import styles from './NewConversation.module.css';
import { verifyJobParams } from './formUtils';
import { AudioDetails, AudioSelection } from './types';

const client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'us-east-1' });
//check this

async function getUserAttributes(username: string) {
    try {
        const user = await getCurrentUser();
        const attributes = await fetchUserAttributes();
        const clinicAttribute = attributes['custom:Clinic'];
        return clinicAttribute || null;
    } catch (error) {
        console.error('Error fetching user attributes: ', error);
        throw error;
    }
}

async function listObjects(bucketName: string): Promise<_Object[]> {
    const command = new ListObjectsV2Command({
        Bucket: bucketName,
    });
    const response: ListObjectsV2Output = await s3Client.send(command);
    return response.Contents || [];
}

async function copyObject(
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: string,
    destinationKey: string
): Promise<void> {
    const command = new CopyObjectCommand({
        Bucket: destinationBucket,
        CopySource: `${sourceBucket}/${sourceKey}`,
        Key: destinationKey,
    });
    await s3Client.send(command);
}

async function deleteObject(bucketName: string, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
    });
    await s3Client.send(command);
}

async function moveObject(
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: string,
    destinationKey: string
): Promise<void> {
    await copyObject(sourceBucket, sourceKey, destinationBucket, destinationKey);
    await deleteObject(sourceBucket, sourceKey);
}

export default function NewConversation() {
    const { updateProgressBar } = useNotificationsContext();
    const navigate = useNavigate();
    const { user } = useAuthContext();
    const loginId = user?.signInDetails?.loginId || 'No username found';
    const [clinicName, setClinicName] = useState<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [formError, setFormError] = useState<string | React.ReactElement[]>('');
    const [jobName, setJobName] = useState<string>('');
    const [audioSelection, setAudioSelection] = useState<AudioSelection>('speakerPartitioning');
    const [audioDetails, setAudioDetails] = useState<AudioDetails>({
        speakerPartitioning: {
            maxSpeakers: 2,
        },
        channelIdentification: {
            channel1: 'CLINICIAN',
        },
    });
    const [filePath, setFilePath] = useState<File>();
    const [outputBucket, getUploadMetadata] = useS3();
    const [submissionMode, setSubmissionMode] = useState<string>('uploadRecording');
    const [recordedAudio, setRecordedAudio] = useState<File | undefined>();

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

    function s3UploadCallback({ loaded, part, total }: Progress) {
        const value = Math.round(((loaded || 1) / (total || 100)) * 99);
        const loadedMb = Math.round((loaded || 1) / 1024 / 1024);
        const totalMb = Math.round((total || 1) / 1024 / 1024);
        updateProgressBar({
            id: `New HealthScribe Job: ${jobName}`,
            value: value,
            description: `Uploaded part ${part}, ${loadedMb}MB / ${totalMb}MB`,
        });
    }

    async function handleUnorganizedFiles(bucketName: string, clinicFolder: string) {
        const objects = await listObjects(bucketName);
        for (const object of objects) {
            const objectKey = object.Key!;
            if (!objectKey.startsWith(clinicFolder)) {
                const destinationKey = `${clinicFolder}/${objectKey}`;
                await moveObject(bucketName, objectKey, bucketName, destinationKey);
            }
        }
    }

    async function submitJob(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');

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
                      },
                  };

        const uploadLocation = getUploadMetadata();
        const s3Location = {
            Bucket: uploadLocation.bucket,
            Key: `${clinicName}/${uploadLocation.key}/${jobName}/${(filePath as File).name}`,
        };

        const userNameTag: Tag = {
            Key: 'UserName',
            Value: loginId,
        };

        const clinicTag: Tag = {
            // Additional tag for clinic
            Key: 'ClinicName',
            Value: clinicName!,
        };

        const jobParams: StartMedicalScribeJobRequest = {
            MedicalScribeJobName: jobName,
            DataAccessRoleArn: amplifyCustom.healthScribeServiceRole,
            OutputBucketName: uploadLocation.bucket, // Use the same bucket as the input
            Media: {
                MediaFileUri: `s3://${s3Location.Bucket}/${s3Location.Key}`,
            },
            ...audioParams,
            Tags: [userNameTag, clinicTag], // Include clinicTag in the Tags array
        };

        const verifyParamResults = verifyJobParams(jobParams);
        if (!verifyParamResults.verified) {
            setFormError(verifyParamResults.message);
            setIsSubmitting(false);
            return;
        }

        window.scrollTo(0, 0);

        updateProgressBar({
            id: `New HealthScribe Job: ${jobName}`,
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
                id: `New HealthScribe Job: ${jobName}`,
                type: 'error',
                value: 0,
                description: 'Uploading files to S3 failed',
                additionalInfo: `Error uploading ${filePath!.name}: ${(e as Error).message}`,
            });
            setIsSubmitting(false);
            throw e;
        }

        try {
            const startJob = await startMedicalScribeJob(jobParams);
            if (startJob?.MedicalScribeJob?.MedicalScribeJobStatus) {
                updateProgressBar({
                    id: `New HealthScribe Job: ${jobName}`,
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
                    id: `New HealthScribe Job: ${jobName}`,
                    type: 'info',
                    value: 100,
                    description: 'Unable to confirm HealthScribe job submission',
                    additionalInfo: `Response from HealthScribe: ${JSON.stringify(startJob)}`,
                });
            }
        } catch (e) {
            updateProgressBar({
                id: `New HealthScribe Job: ${jobName}`,
                type: 'error',
                value: 0,
                description: 'Submitting job to HealthScribe failed',
                additionalInfo: `Error submitting job to HealthScribe: ${(e as Error).message}`,
            });
            setIsSubmitting(false);
            throw e;
        }

        setIsSubmitting(false);
    }

    useEffect(() => {
        setFilePath(recordedAudio);
    }, [recordedAudio]);

    useEffect(() => {
        const fetchClinicName = async () => {
            try {
                const clinicName = await getUserAttributes(loginId);
                if (!clinicName) {
                    setClinicName('No clinic name found');
                    return;
                }
                setClinicName(clinicName);
            } catch (error) {
                console.error('Failed to fetch clinic name', error);
                // Handle the error appropriately
            }
        };

        fetchClinicName();
    }, [loginId]);

    useEffect(() => {
        const fetchClinicName = async () => {
            try {
                const clinic = await getUserAttributes(user?.username || '');
                setClinicName(clinic);
                if (clinic) {
                    await handleUnorganizedFiles(outputBucket, clinic);
                }
            } catch (error) {
                console.error('Error fetching clinic name: ', error);
            }
        };
        if (user) {
            fetchClinicName();
        }
    }, [user, outputBucket]);

    if (clinicName === null) {
        return <Spinner />;
    }

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
                    Logged in as: {loginId}
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
                            <AudioIdentificationType
                                audioSelection={audioSelection}
                                setAudioSelection={setAudioSelection}
                            />
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
