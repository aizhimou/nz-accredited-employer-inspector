interface EmployerFixture {
  employerName?: string;
  tradingName?: string;
  nzbn?: string;
  expiryDateOfAccreditation?: string;
  extraFields?: Array<{ APIColumn: string; Value: string }>;
}

export function createInzResponse(
  employers: EmployerFixture[] = [
    {
      employerName: "CATCH DESIGN LIMITED",
      tradingName: "Bastion Digital",
      nzbn: "9429034641101",
      expiryDateOfAccreditation: "2027-02-17T00:00:00",
    },
  ],
  pagination: { current?: number; totalPages?: number; totalResults?: number } = {},
): Record<string, unknown> {
  const results = employers.map((employer, index) => {
    const fields = [
      employer.employerName === undefined
        ? null
        : { APIColumn: "employerName", Value: employer.employerName },
      employer.tradingName === undefined
        ? null
        : { APIColumn: "tradingName", Value: employer.tradingName },
      employer.nzbn === undefined ? null : { APIColumn: "nzbn", Value: employer.nzbn },
      employer.expiryDateOfAccreditation === undefined
        ? null
        : {
            APIColumn: "expiryDateOfAccreditation",
            Value: employer.expiryDateOfAccreditation,
          },
      ...(employer.extraFields ?? []),
    ].filter((field) => field !== null);

    return {
      field_schema: { raw: fields },
      title: { raw: employer.employerName ?? "Unknown" },
      id: { raw: index + 1 },
    };
  });

  return {
    results: JSON.stringify(results),
    current: pagination.current ?? 1,
    totalPages: pagination.totalPages ?? (results.length === 0 ? 0 : 1),
    totalResults: pagination.totalResults ?? results.length,
  };
}

export const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

