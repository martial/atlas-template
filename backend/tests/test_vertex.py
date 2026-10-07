import google.auth
import pytest
from types import SimpleNamespace
from google.auth.credentials import AnonymousCredentials
from google.auth.exceptions import DefaultCredentialsError

from atlas.ai import VertexAI
from atlas.config import Settings
from atlas.errors import AtlasError


def test_vertex_uses_gcloud_adc_even_with_ambient_key_variables(monkeypatch):
    credentials = AnonymousCredentials()
    calls = []
    def adc(*, scopes):
        calls.append(scopes)
        return credentials, 'gcloud-project'
    monkeypatch.setattr(google.auth, 'default', adc)
    monkeypatch.setenv('GOOGLE_API_KEY', 'unused-test-key')
    monkeypatch.setenv('GEMINI_API_KEY', 'unused-test-key')
    ai = VertexAI(Settings(_env_file=None), lambda: None)
    client = ai.client
    assert client._api_client.vertexai is True
    assert client._api_client.project == 'gcloud-project'
    assert client._api_client.location == 'global'
    assert client._api_client._credentials is credentials
    assert client._api_client.api_key is None
    assert calls == [['https://www.googleapis.com/auth/cloud-platform']]
    assert ai.client is client
    client.close()


def test_explicit_cloud_project_and_location_override_adc_defaults(monkeypatch):
    monkeypatch.setattr(google.auth, 'default', lambda **_: (AnonymousCredentials(), 'adc-default'))
    ai = VertexAI(Settings(_env_file=None, project='storage-project', vertex_project='model-project',
                           vertex_location='eu'), lambda: None)
    assert ai.client._api_client.project == 'model-project'
    assert ai.client._api_client.location == 'eu'
    ai.client.close()


def test_cloud_run_uses_resource_project_with_attached_credentials(monkeypatch):
    monkeypatch.setattr(google.auth, 'default', lambda **_: (AnonymousCredentials(), 'metadata-project'))
    ai = VertexAI(Settings(_env_file=None, project='runtime-project'), lambda: None)
    assert ai.client._api_client.project == 'runtime-project'
    ai.client.close()


def test_missing_adc_explains_gcloud_setup_without_key_fallback(monkeypatch):
    def missing(**_):
        raise DefaultCredentialsError('no credentials')
    monkeypatch.setattr(google.auth, 'default', missing)
    ai = VertexAI(Settings(_env_file=None), lambda: None)
    with pytest.raises(AtlasError, match='gcloud auth application-default login'):
        _ = ai.client


def test_standard_google_environment_variables(monkeypatch):
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'standard-project')
    monkeypatch.setenv('GOOGLE_CLOUD_LOCATION', 'eu')
    settings = Settings(_env_file=None)
    assert settings.vertex_project == 'standard-project' and settings.vertex_location == 'eu'


@pytest.mark.parametrize("output,scope,queries", [
    ('{"scope":"overview","queries":["story"]}', "overview", ["story"]),
    ('{"scope":"search","queries":["specific detail"]}', "search", ["specific detail"]),
    ('{"scope":"overview","queries":"invalid"}', "overview", ["question"]),
    ('[]', "search", ["question"]),
    ('invalid JSON', "search", ["question"]),
])
def test_retrieval_plan_scope_and_invalid_response_fallback(output, scope, queries):
    ai = VertexAI(Settings(_env_file=None), lambda: None)
    calls = []
    def generate(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(text=output)
    ai._client = SimpleNamespace(models=SimpleNamespace(generate_content=generate))
    assert ai.plan("question", []) == {"scope": scope, "queries": queries}
    assert "scope" in calls[0]["config"].response_schema["required"]
