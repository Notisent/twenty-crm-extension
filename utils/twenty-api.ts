import type {
  TwentyTokenPair,
  GraphQLResponse,
  PeopleQueryResult,
  CompaniesQueryResult,
  CreatePersonResult,
  CreateCompanyResult,
  LinkedInProfileData,
  LinkedInCompanyData,
} from '../types';

// GraphQL Queries - Using correct Links composite field structure
// Links type has: primaryLinkUrl, primaryLinkLabel, secondaryLinks
const FIND_PERSON_BY_LINKEDIN = `
  query FindPersonByLinkedIn($filter: PersonFilterInput) {
    people(filter: $filter, first: 1) {
      edges {
        node {
          id
          name {
            firstName
            lastName
          }
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          jobTitle
          avatarUrl
          city
          company {
            id
            name
          }
        }
      }
    }
  }
`;

const FIND_COMPANY_BY_LINKEDIN = `
  query FindCompanyByLinkedIn($filter: CompanyFilterInput) {
    companies(filter: $filter, first: 1) {
      edges {
        node {
          id
          name
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          domainName {
            primaryLinkUrl
            primaryLinkLabel
          }
          employees
        }
      }
    }
  }
`;

const FIND_COMPANY_BY_NAME = `
  query FindCompanyByName($filter: CompanyFilterInput) {
    companies(filter: $filter, first: 5) {
      edges {
        node {
          id
          name
          linkedinLink {
            primaryLinkUrl
          }
        }
      }
    }
  }
`;

const FIND_PERSON_BY_NAME = `
  query FindPersonByName($filter: PersonFilterInput) {
    people(filter: $filter, first: 5) {
      edges {
        node {
          id
          name {
            firstName
            lastName
          }
          linkedinLink {
            primaryLinkUrl
          }
          jobTitle
          company {
            id
            name
          }
        }
      }
    }
  }
`;

const SEARCH_PEOPLE = `
  query SearchPeople($filter: PersonFilterInput) {
    people(filter: $filter, first: 10) {
      edges {
        node {
          id
          name {
            firstName
            lastName
          }
          jobTitle
          company {
            id
            name
          }
        }
      }
    }
  }
`;

const SEARCH_COMPANIES = `
  query SearchCompanies($filter: CompanyFilterInput) {
    companies(filter: $filter, first: 10) {
      edges {
        node {
          id
          name
          domainName {
            primaryLinkUrl
          }
        }
      }
    }
  }
`;

const UPDATE_PERSON = `
  mutation UpdatePerson($id: UUID!, $input: PersonUpdateInput!) {
    updatePerson(id: $id, data: $input) {
      id
      name {
        firstName
        lastName
      }
    }
  }
`;

const UPDATE_COMPANY = `
  mutation UpdateCompany($id: UUID!, $input: CompanyUpdateInput!) {
    updateCompany(id: $id, data: $input) {
      id
      name
    }
  }
`;

const CREATE_PERSON = `
  mutation CreatePerson($input: PersonCreateInput!) {
    createPerson(data: $input) {
      id
      name {
        firstName
        lastName
      }
      linkedinLink {
        primaryLinkUrl
      }
      company {
        id
        name
      }
    }
  }
`;

const CREATE_COMPANY = `
  mutation CreateCompany($input: CompanyCreateInput!) {
    createCompany(data: $input) {
      id
      name
      linkedinLink {
        primaryLinkUrl
      }
    }
  }
`;

export class TwentyApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    const url = baseUrl.replace(/\/$/, '');
    const isLocalhost = url.startsWith('http://localhost') || url.startsWith('http://127.');
    if (!url.startsWith('https://') && !isLocalhost) {
      throw new Error('Twenty URL must use HTTPS');
    }
    try {
      new URL(url);
    } catch {
      throw new Error('Invalid Twenty URL');
    }
    this.baseUrl = url;
  }

  setToken(token: string) {
    this.token = token;
  }



  private async graphqlRequest<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    if (!this.token) {
      throw new Error('No authentication token set');
    }

    const response = await fetch(`${this.baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return response.json();
  }

  async findPersonByLinkedInUrl(
    linkedinUrl: string
  ): Promise<PeopleQueryResult['people']['edges'][0]['node'] | null> {
    const normalizedUrl = this.normalizeLinkedInUrl(linkedinUrl);
    
    const result = await this.graphqlRequest<PeopleQueryResult>(
      FIND_PERSON_BY_LINKEDIN,
      {
        filter: {
          linkedinLink: {
            primaryLinkUrl: {
              ilike: `%${normalizedUrl}%`,
            },
          },
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return result.data?.people.edges[0]?.node || null;
  }

  async findCompanyByLinkedInUrl(
    linkedinUrl: string
  ): Promise<CompaniesQueryResult['companies']['edges'][0]['node'] | null> {
    const normalizedUrl = this.normalizeLinkedInUrl(linkedinUrl);
    
    const result = await this.graphqlRequest<CompaniesQueryResult>(
      FIND_COMPANY_BY_LINKEDIN,
      {
        filter: {
          linkedinLink: {
            primaryLinkUrl: {
              ilike: `%${normalizedUrl}%`,
            },
          },
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return result.data?.companies.edges[0]?.node || null;
  }

  async findCompanyByName(
    companyName: string
  ): Promise<CompaniesQueryResult['companies']['edges'][0]['node'] | null> {
    // Search for company by name (case-insensitive)
    const result = await this.graphqlRequest<CompaniesQueryResult>(
      FIND_COMPANY_BY_NAME,
      {
        filter: {
          name: {
            ilike: `%${companyName}%`,
          },
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    // Try to find exact match first (case-insensitive)
    const companies = result.data?.companies.edges || [];
    const exactMatch = companies.find(
      (c) => c.node.name.toLowerCase() === companyName.toLowerCase()
    );
    
    if (exactMatch) {
      return exactMatch.node;
    }

    // Return first partial match if no exact match
    return companies[0]?.node || null;
  }

  async findPersonByName(
    firstName: string,
    lastName: string
  ): Promise<PeopleQueryResult['people']['edges'][0]['node'] | null> {
    // Search for person by first and last name
    const result = await this.graphqlRequest<PeopleQueryResult>(
      FIND_PERSON_BY_NAME,
      {
        filter: {
          and: [
            {
              name: {
                firstName: {
                  ilike: `%${firstName}%`,
                },
              },
            },
            {
              name: {
                lastName: {
                  ilike: `%${lastName}%`,
                },
              },
            },
          ],
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    // Try to find exact match first (case-insensitive)
    const people = result.data?.people.edges || [];
    const exactMatch = people.find(
      (p) =>
        p.node.name.firstName.toLowerCase() === firstName.toLowerCase() &&
        p.node.name.lastName.toLowerCase() === lastName.toLowerCase()
    );

    if (exactMatch) {
      return exactMatch.node;
    }

    // Return first partial match if no exact match
    return people[0]?.node || null;
  }

  async findOrCreateCompany(
    companyName: string
  ): Promise<{ id: string; name: string; created: boolean }> {
    // First, try to find existing company by name
    const existingCompany = await this.findCompanyByName(companyName);
    
    if (existingCompany) {
      console.log('Found existing company:', existingCompany.name);
      return { id: existingCompany.id, name: existingCompany.name, created: false };
    }

    // Create new company if not found
    console.log('Creating new company:', companyName);
    const newCompany = await this.createCompanySimple(companyName);
    return { id: newCompany.id, name: newCompany.name, created: true };
  }

  // Simple company creation (just name, no LinkedIn URL)
  private async createCompanySimple(
    name: string
  ): Promise<CreateCompanyResult['createCompany']> {
    const result = await this.graphqlRequest<CreateCompanyResult>(
      CREATE_COMPANY,
      {
        input: {
          name,
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    if (!result.data?.createCompany) {
      throw new Error('Failed to create company');
    }

    return result.data.createCompany;
  }

  async createPerson(
    data: LinkedInProfileData
  ): Promise<CreatePersonResult['createPerson'] & { companyCreated?: boolean }> {
    let companyId: string | undefined;
    let companyCreated = false;

    // If person has a company, find or create it first
    console.log('[Twenty] createPerson - currentCompany:', data.currentCompany);
    if (data.currentCompany) {
      console.log('[Twenty] Attempting to find or create company:', data.currentCompany);
      try {
        const companyResult = await this.findOrCreateCompany(data.currentCompany);
        companyId = companyResult.id;
        companyCreated = companyResult.created;
        console.log(`[Twenty] Company ${companyResult.created ? 'created' : 'found'}:`, companyResult.name, 'id:', companyId);
      } catch (error) {
        console.error('[Twenty] Error finding/creating company:', error);
        // Continue without company link if this fails
      }
    } else {
      console.log('[Twenty] No currentCompany in data, skipping company creation');
    }

    const avatarUrl = data.profileImageUrl || '';

    const result = await this.graphqlRequest<CreatePersonResult>(CREATE_PERSON, {
      input: {
        name: {
          firstName: data.firstName,
          lastName: data.lastName,
        },
        linkedinLink: {
          primaryLinkUrl: data.linkedinUrl,
          primaryLinkLabel: 'LinkedIn',
        },
        jobTitle: data.jobTitleFromExperience || data.headline || '',
        avatarUrl: avatarUrl,
        city: data.location || '',
        companyId: companyId,
        // Custom fields from experience section
        ...(data.employmentType && { employmentType: data.employmentType }),
        ...(data.jobStartDate && { jobStartDate: data.jobStartDate }),
        ...(data.workArrangement && { workArrangement: data.workArrangement }),
        ...(data.jobDescription && { jobDescription: data.jobDescription }),
      },
    });

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    if (!result.data?.createPerson) {
      throw new Error('Failed to create person');
    }

    return { ...result.data.createPerson, companyCreated };
  }

  async createCompany(
    data: LinkedInCompanyData
  ): Promise<CreateCompanyResult['createCompany']> {
    const result = await this.graphqlRequest<CreateCompanyResult>(
      CREATE_COMPANY,
      {
        input: {
          name: data.name,
          linkedinLink: {
            primaryLinkUrl: data.linkedinUrl,
            primaryLinkLabel: 'LinkedIn',
          },
          domainName: data.website
            ? {
                primaryLinkUrl: data.website,
                primaryLinkLabel: 'Website',
              }
            : undefined,
          employees: data.employeeCount
            ? this.parseEmployeeCount(data.employeeCount)
            : undefined,
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    if (!result.data?.createCompany) {
      throw new Error('Failed to create company');
    }

    return result.data.createCompany;
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.graphqlRequest<{ people: unknown }>(
        `query { people(first: 1) { edges { node { id } } } }`
      );
      return !result.errors?.length && result.data?.people !== undefined;
    } catch (err) {
      console.error('[Twenty] testConnection error:', err);
      return false;
    }
  }

  // Search for records by name
  async searchRecords(
    query: string,
    type: 'person' | 'company'
  ): Promise<Array<{ id: string; name: string; subtitle?: string; type: 'person' | 'company' }>> {
    if (type === 'person') {
      const result = await this.graphqlRequest<PeopleQueryResult>(SEARCH_PEOPLE, {
        filter: {
          or: [
            { name: { firstName: { ilike: `%${query}%` } } },
            { name: { lastName: { ilike: `%${query}%` } } },
          ],
        },
      });

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }

      return (result.data?.people.edges || []).map((edge) => ({
        id: edge.node.id,
        name: `${edge.node.name.firstName} ${edge.node.name.lastName}`,
        subtitle: edge.node.jobTitle || edge.node.company?.name || undefined,
        type: 'person' as const,
      }));
    } else {
      const result = await this.graphqlRequest<CompaniesQueryResult>(SEARCH_COMPANIES, {
        filter: {
          name: { ilike: `%${query}%` },
        },
      });

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }

      return (result.data?.companies.edges || []).map((edge) => ({
        id: edge.node.id,
        name: edge.node.name,
        subtitle: edge.node.domainName?.primaryLinkUrl || undefined,
        type: 'company' as const,
      }));
    }
  }

  // Update existing record with LinkedIn data
  async updateRecordWithLinkedInData(
    id: string,
    type: 'person' | 'company',
    data: LinkedInProfileData | LinkedInCompanyData
  ): Promise<void> {
    if (type === 'person' && data.type === 'person') {
      const personData = data as LinkedInProfileData;
      
      // Find or create company if present
      let companyId: string | undefined;
      if (personData.currentCompany) {
        try {
          const companyResult = await this.findOrCreateCompany(personData.currentCompany);
          companyId = companyResult.id;
        } catch (error) {
          console.error('Error finding/creating company:', error);
        }
      }

      const avatarUrl = personData.profileImageUrl || undefined;

      const result = await this.graphqlRequest<{ updatePerson: { id: string } }>(
        UPDATE_PERSON,
        {
          id,
          input: {
            name: {
              firstName: personData.firstName,
              lastName: personData.lastName,
            },
            linkedinLink: {
              primaryLinkUrl: personData.linkedinUrl,
              primaryLinkLabel: 'LinkedIn',
            },
            jobTitle: personData.jobTitleFromExperience || personData.headline || undefined,
            avatarUrl: avatarUrl,
            city: personData.location || undefined,
            companyId: companyId,
            // Custom fields from experience section
            ...(personData.employmentType && { employmentType: personData.employmentType }),
            ...(personData.jobStartDate && { jobStartDate: personData.jobStartDate }),
            ...(personData.workArrangement && { workArrangement: personData.workArrangement }),
            ...(personData.jobDescription && { jobDescription: personData.jobDescription }),
          },
        }
      );

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }
    } else if (type === 'company' && data.type === 'company') {
      const companyData = data as LinkedInCompanyData;

      const result = await this.graphqlRequest<{ updateCompany: { id: string } }>(
        UPDATE_COMPANY,
        {
          id,
          input: {
            name: companyData.name,
            linkedinLink: {
              primaryLinkUrl: companyData.linkedinUrl,
              primaryLinkLabel: 'LinkedIn',
            },
            domainName: companyData.website
              ? {
                  primaryLinkUrl: companyData.website,
                  primaryLinkLabel: 'Website',
                }
              : undefined,
            employees: companyData.employeeCount
              ? this.parseEmployeeCount(companyData.employeeCount)
              : undefined,
          },
        }
      );

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }
    }
  }

  private normalizeLinkedInUrl(url: string): string {
    // Extract the profile/company identifier from various LinkedIn URL formats
    const match = url.match(/linkedin\.com\/(in|company)\/([^/?]+)/);
    return match ? match[2] : url;
  }

  private parseEmployeeCount(countStr: string): number | undefined {
    // Parse employee count strings like "1,001-5,000 employees"
    const match = countStr.match(/(\d+(?:,\d+)?)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
    return undefined;
  }
}

// Helper to extract token from Twenty's tokenPair cookie
export function extractTokenFromCookie(
  cookieValue: string
): string | null {
  try {
    const tokenPair: TwentyTokenPair = JSON.parse(cookieValue);
    return tokenPair.accessOrWorkspaceAgnosticToken?.token || null;
  } catch {
    return null;
  }
}
