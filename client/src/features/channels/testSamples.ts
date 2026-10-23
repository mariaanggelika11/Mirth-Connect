import { DataType } from '../../types';

export const formatSample = (format: DataType) => {
  if (format === DataType.XML)
    return '<Patient id="SYNTHETIC-001"><name><first>Example</first><last>Patient</last></name><dob>1990-05-20</dob><gender>U</gender></Patient>';
  if (format === DataType.HL7V2)
    return 'MSH|^~\\&|SYNTHETIC|TEST|RECEIVER|TEST|20261018220000||ADT^A04|SYNTHETIC-001|T|2.5\rEVN|A04|20261018220000\rPID|1||SYNTHETIC-001^^^TEST^MR||Patient^Example||19900520|U\rPV1|1|O\r';
  if (format === DataType.TEXT) return 'Synthetic example message';
  return JSON.stringify(
    {
      message_id: 'SYNTHETIC-001',
      patient_id: 'SYNTHETIC-001',
      first_name: 'Example',
      last_name: 'Patient',
      dob: '1990-05-20',
      gender: 'U',
      patient: { id: 'SYNTHETIC-001', name: { first: 'Example', last: 'Patient' } },
      observations: [{ code: 'SYNTHETIC', value: 1 }],
    },
    null,
    2,
  );
};
