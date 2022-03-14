# setup-pandoc
This action is based on the [setup-pandoc action of r-lib](https://github.com/r-lib/actions). It differs in the following ways:
- When not specified, it will use the latest pandoc version available
- Support for tool cache
- Support for other Linux distributions beside debian derivatives

This action sets up pandoc for use in later steps in an action.
## Usage
See [action.yml](action.yml)


Usage with latest pandoc version:
```yaml
steps:
- uses: actions/checkout@master
- uses: nikeee/setup-pandoc@v1
- run: echo "# Test" | pandoc -t html
```

Example usage win specific version:
```yaml
steps:
- uses: actions/checkout@master
- uses: nikeee/setup-pandoc@v1
  with:
    pandoc-version: '2.7.3' # The pandoc version to download (if necessary) and use.
- run: echo "# Test" | pandoc -t html
```

## License
The scripts and documentation in this project are released under the [MIT License](LICENSE).

## Contributions
Contributions are welcome!
