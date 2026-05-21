export type OptionSpec = {
  valueOptions: Iterable<string>;
  boolOptions: Iterable<string>;
};

export type ArgvSplit = {
  globalArgv: string[];
  commandArgv: string[];
};

export function splitAtSubcommand(argv: string[], spec: OptionSpec): ArgvSplit {
  const valueOptions = new Set(spec.valueOptions);
  const boolOptions = new Set(spec.boolOptions);

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) break;

    if (arg === '--') {
      return {
        globalArgv: argv.slice(0, index),
        commandArgv: argv.slice(index + 1),
      };
    }

    if (arg.startsWith('-')) {
      const optionName =
        arg.startsWith('--') && arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (arg.startsWith('--') && arg.includes('=')) {
        index += 1;
      } else if (valueOptions.has(optionName)) {
        index += 2;
      } else if (boolOptions.has(optionName)) {
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }

    return {
      globalArgv: argv.slice(0, index),
      commandArgv: argv.slice(index),
    };
  }

  return { globalArgv: argv, commandArgv: [] };
}
