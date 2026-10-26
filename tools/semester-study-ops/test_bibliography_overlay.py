import copy
import hashlib
import unittest
from bibliography_overlay import corrected

class BibliographyOverlayTests(unittest.TestCase):
    def fixture(self):
        b={'records':[{'id':'synthetic','authors':'corrupted-name','verifiedReportedResult':None}]};digest='a'*64
        r={'schemaVersion':1,'checkedAt':'2026-10-26','scope':'synthetic metadata only','inputBibliographySha256':digest,'records':[{'id':'synthetic','status':'PRIMARY_METADATA_OR_DOCUMENTATION_CHECKED','primaryUrl':'https://example.org/primary'}],'fieldUpdates':[{'id':'synthetic','field':'authors','expectedValueSha256':hashlib.sha256(b'corrupted-name').hexdigest(),'value':'SYNTHETIC Löfström','primaryUrl':'https://example.org/primary','reason':'Synthetic correction'}]}
        return b,digest,r
    def test_unicode_copy_preserves_original_and_claims(self):
        b,h,r=self.fixture();before=copy.deepcopy(b);c=corrected(b,h,r);self.assertEqual(b,before);self.assertEqual(c['records'][0]['authors'],'SYNTHETIC Löfström');self.assertIsNone(c['records'][0]['verifiedReportedResult'])
    def test_input_or_field_drift_rejected(self):
        b,h,r=self.fixture()
        with self.assertRaises(ValueError):corrected(b,'0'*64,r)
        b['records'][0]['authors']='changed'
        with self.assertRaises(ValueError):corrected(b,h,r)
    def test_access_limited_cannot_update(self):
        b,h,r=self.fixture();r['records'][0]['status']='ACCESS_LIMITED'
        with self.assertRaises(ValueError):corrected(b,h,r)
    def test_no_silent_scientific_result_update(self):
        b,h,r=self.fixture();r['fieldUpdates'][0]['field']='verifiedReportedResult';r['fieldUpdates'][0]['value']='fabricated score'
        with self.assertRaises(ValueError):corrected(b,h,r)
if __name__=='__main__':unittest.main()
