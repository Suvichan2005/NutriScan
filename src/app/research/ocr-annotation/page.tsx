import registry from '../../../../data/ocr-photo-candidate-register.json';
import AnnotationClient, { type AnnotationCandidate } from './annotation-client';

export default function OcrAnnotationPage() {
  const candidates:AnnotationCandidate[] = registry.candidates
    .filter(candidate=>candidate.status==='pending-independent-human-annotation')
    .map(candidate=>({
      imageId:candidate.imageId,
      productGroupId:candidate.productGroupId,
      productName:candidate.productName,
      sha256:candidate.image.sha256,
      width:candidate.image.width,
      height:candidate.image.height,
      byteLength:candidate.image.byteLength,
      source:{
        url:candidate.productPageUrl,
        imageUrl:candidate.sourceImageUrl,
        publisher:registry.sourcePublisher,
        uploader:candidate.uploader,
        licenseId:candidate.licenseId,
        licenseUrl:registry.licenseGuidanceUrl,
        retrievedAt:registry.retrievedAt,
        redistributionReview:'pending'
      }
    }));

  return <AnnotationClient candidates={candidates}/>;
}
