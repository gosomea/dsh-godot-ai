import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, parseCatalogSignatureEnvelope, parseCatalogTrustRoot, parseSkillCatalog } from '../lib/index.js'

function optionalArgument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function argument(name) {
  const value = optionalArgument(name)
  if (value === undefined) throw new Error(`missing ${name}`)
  return value
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${canonicalJson(value)}\n`, { mode: 0o600 })
}

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(repositoryRoot, argument('--catalog'))
const auditReportPath = resolve(repositoryRoot, argument('--audit-report'))
const signaturePath = resolve(repositoryRoot, argument('--signature'))
const trustRootPath = resolve(repositoryRoot, argument('--trust-root'))
const checksumsPath = resolve(repositoryRoot, argument('--checksums'))
const configuredKeyPath = optionalArgument('--private-key') ?? process.env.DSH_GODOT_AI_CATALOG_KEY
if (configuredKeyPath === undefined) throw new Error('set DSH_GODOT_AI_CATALOG_KEY or pass --private-key')
const privateKeyPath = resolve(configuredKeyPath)
const keyId = argument('--key-id')
const notBefore = argument('--not-before')
if (Number.isNaN(Date.parse(notBefore))) throw new Error('--not-before must be an ISO timestamp')

const catalogBytes = await readFile(catalogPath)
const catalog = parseSkillCatalog(JSON.parse(catalogBytes.toString('utf8')))
const privateKey = createPrivateKey(await readFile(privateKeyPath))
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('catalog private key must be Ed25519')
const publicKey = createPublicKey(privateKey)
const catalogSha256 = sha256(catalogBytes)
const envelope = parseCatalogSignatureEnvelope({
  algorithm: 'Ed25519',
  keyId,
  catalogSha256,
  signature: sign(null, catalogBytes, privateKey).toString('base64'),
})
await writeJson(signaturePath, envelope)

const trustRoot = parseCatalogTrustRoot({
  schemaVersion: 1,
  threshold: 1,
  keys: [{
    keyId,
    algorithm: 'Ed25519',
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    status: 'active',
    notBefore,
  }],
  initialCatalog: { serial: catalog.serial, sha256: catalogSha256 },
})
await writeJson(trustRootPath, trustRoot)
const checksums = {
  'catalog.json': catalogSha256,
  'catalog-audit.json': sha256(await readFile(auditReportPath)),
  'catalog.sig.json': sha256(await readFile(signaturePath)),
  'skill-catalog-root.json': sha256(await readFile(trustRootPath)),
}
await writeJson(checksumsPath, checksums)
process.stdout.write(`${JSON.stringify({ keyId, catalogSerial: catalog.serial, catalogSha256, publicKeySha256: sha256(publicKey.export({ format: 'der', type: 'spki' })) })}\n`)
