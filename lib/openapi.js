// OpenAPI 3.0 스펙 — Redoc 이 렌더하고 외부 도구가 client 생성에 사용.
export function buildOpenApiSpec({ serverUrl }) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'ysadmin Public API',
      version: '1.0.0',
      description:
        'iPhone 위젯 등 외부 클라이언트에서 컴퓨터 전원 상태 조회 및 켜기/끄기를 수행하기 위한 REST API. ' +
        '모든 엔드포인트는 `Authorization: Bearer <API_KEY>` 헤더가 필요합니다.',
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: 'computers', description: '컴퓨터 전원/상태' }],
    paths: {
      '/api/v1/computers': {
        get: {
          tags: ['computers'],
          summary: '컴퓨터 목록',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      computers: { type: 'array', items: { $ref: '#/components/schemas/Computer' } },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/computers/{id}': {
        parameters: [{ $ref: '#/components/parameters/ComputerId' }],
        get: {
          tags: ['computers'],
          summary: '단일 컴퓨터 조회',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { computer: { $ref: '#/components/schemas/Computer' } },
                  },
                },
              },
            },
            404: { $ref: '#/components/responses/NotFound' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/computers/{id}/status': {
        parameters: [{ $ref: '#/components/parameters/ComputerId' }],
        get: {
          tags: ['computers'],
          summary: '실시간 상태 확인 (ping)',
          description: '대상 IP 로 ping/포트 체크를 시도해 최신 상태를 갱신합니다.',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { $ref: '#/components/schemas/StatusReport' },
                      computer: { $ref: '#/components/schemas/Computer' },
                    },
                  },
                },
              },
            },
            404: { $ref: '#/components/responses/NotFound' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/computers/{id}/wake': {
        parameters: [{ $ref: '#/components/parameters/ComputerId' }],
        post: {
          tags: ['computers'],
          summary: '켜기 (Wake-on-LAN)',
          responses: {
            200: {
              description: '매직 패킷 전송 완료',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      computer: { $ref: '#/components/schemas/Computer' },
                    },
                  },
                },
              },
            },
            404: { $ref: '#/components/responses/NotFound' },
            401: { $ref: '#/components/responses/Unauthorized' },
            500: { $ref: '#/components/responses/Error' },
          },
        },
      },
      '/api/v1/computers/{id}/shutdown': {
        parameters: [{ $ref: '#/components/parameters/ComputerId' }],
        post: {
          tags: ['computers'],
          summary: '끄기 (SSH shutdown)',
          description: '컴퓨터 설정에서 SSH 끄기가 활성화돼 있어야 합니다.',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/NotFound' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/computers/{id}/toggle': {
        parameters: [{ $ref: '#/components/parameters/ComputerId' }],
        post: {
          tags: ['computers'],
          summary: '토글 (마지막 status 기준 wake↔shutdown 분기)',
          description:
            '위젯의 단일 버튼용. `status==="up"` 이면 shutdown, 그 외에는 wake. ' +
            'shutdown 분기를 타려면 컴퓨터의 SSH 끄기 설정이 활성화돼 있어야 합니다.',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      action: { type: 'string', enum: ['wake', 'shutdown'] },
                    },
                    additionalProperties: true,
                  },
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/NotFound' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: '관리자 콘솔의 "API 키" 화면에서 발급한 키. 예: `ysa_xxx...`',
        },
      },
      parameters: {
        ComputerId: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: '컴퓨터 UUID',
        },
      },
      responses: {
        Unauthorized: {
          description: 'API 키 누락 또는 무효',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: '대상 없음',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Error: {
          description: '일반 오류',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        Computer: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            mac: { type: 'string', example: '08-BF-B8-13-11-95' },
            ip: { type: 'string', nullable: true },
            os: { type: 'string', enum: ['windows', 'macos', 'linux', 'unknown'] },
            status: { type: 'string', enum: ['up', 'down', 'unknown'] },
            lastCheckedAt: { type: 'string', format: 'date-time', nullable: true },
            lastWokenAt: { type: 'string', format: 'date-time', nullable: true },
            shutdownEnabled: { type: 'boolean' },
          },
        },
        StatusReport: {
          type: 'object',
          properties: {
            reachable: { type: 'boolean' },
            method: { type: 'string', nullable: true },
            latencyMs: { type: 'integer', nullable: true },
          },
          additionalProperties: true,
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  };
}
