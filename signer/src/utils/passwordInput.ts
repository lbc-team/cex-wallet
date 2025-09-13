/**
 * 交互式密码输入工具
 * 支持隐藏输入和基本验证
 */

/**
 * 交互式密码输入（隐藏输入）
 * @param prompt 提示信息
 * @param minLength 最小长度要求
 * @returns Promise<string> 用户输入的密码
 */
export async function promptForPassword(
  prompt: string = '请输入助记词密码（至少8个字符）:',
  minLength: number = 8
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(prompt);
    
    // 检查是否支持原始模式（交互式终端）
    const isTTY = process.stdin.isTTY;
    
    if (isTTY && process.stdin.setRawMode) {
      // 交互式终端，使用隐藏输入
      process.stdout.write('密码: ');
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      let password = '';
      
      const onData = (char: string) => {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            
            if (!password) {
              console.error('错误: 密码不能为空');
              process.exit(1);
            }
            
            if (password.length < minLength) {
              console.error(`错误: 密码长度至少需要${minLength}个字符`);
              process.exit(1);
            }
            
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            console.log('\n\n操作已取消');
            process.exit(0);
            break;
          case '\u007f': // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };
      
      process.stdin.on('data', onData);
    } else {
      // 非交互式终端（如管道输入），使用简单输入
      process.stdout.write('密码: ');
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      let password = '';
      
      const onData = (data: string) => {
        password = data.trim();
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        
        if (!password) {
          console.error('错误: 密码不能为空');
          process.exit(1);
        }
        
        if (password.length < minLength) {
          console.error(`错误: 密码长度至少需要${minLength}个字符`);
          process.exit(1);
        }
        
        resolve(password);
      };
      
      process.stdin.on('data', onData);
    }
  });
}

/**
 * 确认密码输入（用于设置新密码时）
 * @param prompt 提示信息
 * @param minLength 最小长度要求
 * @returns Promise<string> 确认后的密码
 */
export async function promptForPasswordConfirmation(
  prompt: string = '请确认密码:',
  minLength: number = 8
): Promise<string> {
  return promptForPassword(prompt, minLength);
}

/**
 * 验证密码强度
 * @param password 密码
 * @param minLength 最小长度
 * @returns 验证结果
 */
export function validatePasswordStrength(
  password: string, 
  minLength: number = 8
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!password) {
    errors.push('密码不能为空');
  }
  
  if (password.length < minLength) {
    errors.push(`密码长度至少需要${minLength}个字符`);
  }
  
  // 可以添加更多强度检查
  // if (!/[A-Z]/.test(password)) {
  //   errors.push('密码应包含至少一个大写字母');
  // }
  
  // if (!/[a-z]/.test(password)) {
  //   errors.push('密码应包含至少一个小写字母');
  // }
  
  // if (!/\d/.test(password)) {
  //   errors.push('密码应包含至少一个数字');
  // }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
