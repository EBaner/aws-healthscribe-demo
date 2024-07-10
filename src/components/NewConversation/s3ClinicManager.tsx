import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { Buffer } from 'buffer';
import { getConfigRegion, getCredentials } from '@/utils/Sdk';
import { useS3 } from '@/hooks/useS3';

const s3Client = new S3Client({
    region: getConfigRegion(),
    credentials: await getCredentials(),
});
const [outputBucket, getUploadMetadata] = useS3();
const BUCKET_NAME = outputBucket;
const CLINIC_DATA_FILE = 'clinics.json';

async function getClinicData(): Promise<{ [key: string]: number }> {
    try {
        const data = await s3Client.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: CLINIC_DATA_FILE
        }));

        const bodyStream = data.Body as Readable;
        const chunks = [];

        for await (const chunk of bodyStream) {
            chunks.push(chunk);
        }

        const body = Buffer.concat(chunks).toString('utf-8');
        return JSON.parse(body);
    } catch (error: any) {
        if (error.name === 'NoSuchKey') {
            console.log(`Clinic data file '${CLINIC_DATA_FILE}' not found. Creating a new file.`);
            await createEmptyClinicDataFile();
            return {};
        } else {
            console.error('Error fetching clinic data:', error);
            return {};
        }
    }
}

async function createEmptyClinicDataFile(): Promise<void> {
    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: CLINIC_DATA_FILE,
            Body: JSON.stringify({}),
            ContentType: 'application/json'
        }));
        console.log(`Created empty clinic data file '${CLINIC_DATA_FILE}' successfully.`);
    } catch (error) {
        console.error('Error creating empty clinic data file:', error);
    }
}

async function updateClinicData(clinicName: string, jobCount: number): Promise<void> {
    try {
        const currentData = await getClinicData();
        currentData[clinicName] = jobCount;
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: CLINIC_DATA_FILE,
            Body: JSON.stringify(currentData),
            ContentType: 'application/json'
        }));
    } catch (error) {
        console.error('Error updating clinic data:', error);
    }
}

export { getClinicData, updateClinicData };
