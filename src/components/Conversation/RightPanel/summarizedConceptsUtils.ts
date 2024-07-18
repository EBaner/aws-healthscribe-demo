import { DetectEntitiesV2Response } from '@aws-sdk/client-comprehendmedical';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { useS3 } from '@/hooks/useS3';
import { ExtractedHealthData, SegmentExtractedData, SummarySectionEntityMapping } from '@/types/ComprehendMedical';
import { IAuraClinicalDocOutputSection } from '@/types/HealthScribe';
import { getCredentials } from '@/utils/Sdk';
import { flattenAndUnique } from '@/utils/array';

/**
 * Remove leading dashes and trims the string
 * E.g. " - summary" returns "summary"
 */
export function processSummarizedSegment(summarizedSegment: string): string {
    return summarizedSegment.trim().replace(/^-/, '').trim();
}

export async function fetchSummaryJson(jobName: string) {
    console.log(`Attempting to fetch summary for job: ${jobName}`);
    const s3Client = new S3Client({
        region: 'us-east-1',
        credentials: await getCredentials(),
    });

    const [outputBucket, getUploadMetadata] = useS3();
    console.log(`Output bucket: ${outputBucket}`);
    const key = `${jobName}/summary.json`;
    console.log(`Fetching from key: ${key}`);

    const getParams = {
        Bucket: outputBucket,
        Key: key,
    };

    try {
        const command = new GetObjectCommand(getParams);
        const response = await s3Client.send(command);

        if (response.Body) {
            const str = await response.Body.transformToString();
            const parsedData = JSON.parse(str);
            console.log('Successfully fetched and parsed summary data');
            return parsedData;
        } else {
            throw new Error('Empty response body');
        }
    } catch (error) {
        console.error('Error fetching summary.json:', error);
        throw error;
    }
}

export function transformToSegmentExtractedData(
    entities: DetectEntitiesV2Response[] | undefined
): SegmentExtractedData[] | undefined {
    if (!entities) return undefined;

    return entities.map((entity) => ({
        words: [], // We don't have word-level data here, so we'll leave it empty
        extractedData: entity.Entities || [],
    }));
}

/**
 * Merge HealthScribe output with Comprehend Medical output
 * @param sections - HealthScribe output sections
 * @param sectionsWithEntities - Comprehend Medical output sections
 * @returns SummarySectionEntityMapping[]
 */
export function mergeHealthScribeOutputWithComprehendMedicalOutput(
    sections: IAuraClinicalDocOutputSection[],
    sectionsWithEntities: ExtractedHealthData[]
): SummarySectionEntityMapping[] {
    if (sections.length === 0 || sectionsWithEntities.length === 0) return [];

    const buildSectionsWithExtractedData: SummarySectionEntityMapping[] = [];

    sections.forEach((section) => {
        const sectionName = section.SectionName;
        const sectionWithEntities = sectionsWithEntities.find((s) => s.SectionName === sectionName);

        const currentSectionExtractedData: SegmentExtractedData[] = [];
        section.Summary.forEach((summary, i) => {
            const segmentExtractedData: SegmentExtractedData = { words: [] };
            const summarizedSegment = processSummarizedSegment(summary.SummarizedSegment);
            const summarizedSegmentSplit = summarizedSegment.split(' ');
            if (typeof sectionWithEntities === 'undefined') return;
            const segmentEvidence = sectionWithEntities?.ExtractedEntities?.[i]?.Entities || [];
            segmentExtractedData.words = summarizedSegmentSplit.map((w) => {
                return { word: w, linkedId: [] };
            });
            segmentExtractedData.extractedData = segmentEvidence;

            // offset character map. key: character index, value: array of extractedData ids
            const offsetIdMap = new Map();
            segmentExtractedData.extractedData.forEach(({ BeginOffset, EndOffset, Id }) => {
                if (typeof BeginOffset === 'number' && typeof EndOffset === 'number') {
                    for (let i = BeginOffset; i <= EndOffset; i++) {
                        if (!offsetIdMap.has(i)) {
                            offsetIdMap.set(i, []);
                        }
                        offsetIdMap.get(i).push(Id);
                    }
                }
            });

            // iterate over each word by character. if the character appears in the offset map,
            // find the unique extracted data ids and append it to the word object
            let charCount = 0;
            let charCurrent = 0;
            for (let wordIndex = 0; wordIndex < summarizedSegmentSplit.length; wordIndex++) {
                const word = summarizedSegmentSplit[wordIndex];
                const wordLength = word.length;
                charCount += wordLength + 1;
                const wordDataIds = [];
                // iterate from the current character to the current character + word length + 1 (space)
                while (charCurrent < charCount) {
                    wordDataIds.push(offsetIdMap.get(charCurrent) || []);
                    charCurrent++;
                }
                segmentExtractedData.words[wordIndex].linkedId = flattenAndUnique(wordDataIds);

                // break out of the loop if there's no more extracted health data
                if (charCount >= Math.max(...offsetIdMap.keys())) break;
            }

            currentSectionExtractedData.push(segmentExtractedData);
        });
        buildSectionsWithExtractedData.push({
            SectionName: sectionName,
            Summary: currentSectionExtractedData,
        });
    });
    return buildSectionsWithExtractedData;
}
