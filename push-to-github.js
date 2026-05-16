const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const dir = process.cwd();
const repoUrl = 'https://github.com/Digital8x/tribeca.git';
const token = process.env.GITHUB_TOKEN || ''; // Read from environment instead of hardcoding

async function push() {
  console.log('🚀 Starting Git Push with chunked files...');

  try {
    if (!fs.existsSync(path.join(dir, '.git'))) await git.init({ fs, dir });
    try { await git.addRemote({ fs, dir, remote: 'origin', url: repoUrl }); } catch (e) {}

    // Add code files first (small)
    const codeFiles = ['index.html', 'server.js', 'style.css', 'script.js', 'admin.html', 'package.json', '.gitignore'];
    for (const f of codeFiles) {
      if (fs.existsSync(path.join(dir, f))) await git.add({ fs, dir, filepath: f });
    }

    console.log('Committing code...');
    await git.commit({
      fs, dir,
      author: { name: 'Antigravity AI', email: 'ai@antigravity.com' },
      message: 'Initial Code Push'
    });

    console.log('Pushing code...');
    await git.push({
      fs, http, dir, remote: 'origin', ref: 'main', force: true,
      onAuth: () => ({ username: token, password: '' })
    });

    console.log('✅ Code pushed. Now adding assets...');
    
    // Add assets in chunks
    const allFiles = fs.readdirSync(dir).filter(f => !['node_modules', '.git', 'data', 'push-to-github.js', ...codeFiles].includes(f));
    for (const f of allFiles) {
      await git.add({ fs, dir, filepath: f });
    }

    await git.commit({
      fs, dir,
      author: { name: 'Antigravity AI', email: 'ai@antigravity.com' },
      message: 'Adding assets'
    });

    console.log('Pushing assets...');
    await git.push({
      fs, http, dir, remote: 'origin', ref: 'main',
      onAuth: () => ({ username: token, password: '' })
    });

    console.log('✅ All files pushed successfully!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

push();
