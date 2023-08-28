
FROM oven/bun as builder

ADD package.json bun.lockb src tsconfig.json index.ts ./
RUN bun install
RUN bun build ./index.ts --compile --outfile gitlab-sso-scim

FROM scratch

COPY --from=builder gitlab-sso-scim /gitlab-sso-scim
ENTRYPOINT [ "/gitlab-sso-scim" ]
