const http = require('http');

const makeRequest = (path, method = 'GET', data = null, token = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (_e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
};

const runTests = async () => {
  console.log('--- TESTING HEALTH & AUTH ENDPOINTS ---');
  const health = await makeRequest('/health');
  console.log('Health Check Status:', health.status);

  // Test Login as SuperAdmin
  const adminLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'admin@enlogada.com',
    password: 'Password123!'
  });
  console.log('SuperAdmin Login Status:', adminLogin.status);
  console.log('SuperAdmin Roles:', adminLogin.data?.data?.user?.roles);
  console.log('SuperAdmin Permissions Count:', adminLogin.data?.data?.user?.permissions?.length);

  const adminToken = adminLogin.data?.data?.token;

  // Test Login as Client
  const clientLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'client@enlogada.com',
    password: 'Password123!'
  });
  console.log('Client Login Status:', clientLogin.status);
  console.log('Client Roles:', clientLogin.data?.data?.user?.roles);
  console.log('Client Permissions:', clientLogin.data?.data?.user?.permissions);

  if (adminToken) {
    console.log('\n--- TESTING DYNAMIC RBAC MATRIX ENDPOINT ---');
    const rbacMatrix = await makeRequest('/api/rbac/matrix', 'GET', null, adminToken);
    console.log('RBAC Matrix Status:', rbacMatrix.status);
    console.log('Roles Count:', rbacMatrix.data?.data?.roles?.length);
    console.log('Permissions Count:', rbacMatrix.data?.data?.permissions?.length);
  }
};

runTests().catch(console.error);
