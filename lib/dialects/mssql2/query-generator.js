var Utils                  = require("../../utils")
  , util                   = require("util")
  , DataTypes              = require("../../data-types")
  , SqlString              = require('../../sql-string')
  , Transaction            = require("../../transaction")
  , tables                 = {}
  , primaryKeys            = {}
  , AbstractQueryGenerator = require("../abstract/query-generator")

module.exports = (function() {
  var processAndEscapeValue = function(value) {
    var processedValue = value

    if (value instanceof Date) {
      return Utils.addTicks(SqlString.dateToString(value, 'local'), "'")
    } else if (typeof value === 'boolean') {
      processedValue = value ? 1 : 0
    } else if (value === null) {
      return "NULL"
    } else if (typeof value === 'number') {
      return value
    }

    return SqlString.escape(processedValue)
  }

  var QueryGenerator = {
    options: {},
    dialect: 'mssql',
    addSchema: function(opts) {
      var tableName         = undefined
      var schema            = (!!opts.options && !!opts.options.schema ? opts.options.schema : undefined)
      var schemaDelimiter   = (!!opts.options && !!opts.options.schemaDelimiter ? opts.options.schemaDelimiter : undefined)

      if (!!opts.tableName) {
        tableName = opts.tableName
      }
      else if (typeof opts === "string") {
        tableName = opts
      }

      if (!schema || schema.toString().trim() === "") {
        return tableName
      }

      return QueryGenerator.addQuotes(schema) + '.' + QueryGenerator.addQuotes(tableName)
    },

    createSchema: function(schema) {
      var query = "CREATE SCHEMA <%= schema%>;"
      return Utils._.template(query)({schema: schema})
    },

    dropSchema: function(schema) {
      var query = "DROP SCHEMA <%= schema%>;"
      return Utils._.template(query)({schema: schema})
    },

    showSchemasQuery: function() {
      return "SELECT schema_name FROM information_schema.schemata WHERE schema_name <> 'INFORMATION_SCHEMA' AND schema_name != 'sys' AND schema_name LIKE 'db[_]%';"
    },

    createTableQuery: function(tableName, attributes, options) {
      var query         = "IF OBJECT_ID('<%= unquotedTable %>', N'U') IS NULL CREATE TABLE <%= table %> (<%= attributes%>)"
        , attrStr       = []
        , uniqueColumns = []
        , primaryKeys   = Utils._.keys(Utils._.pick(attributes, function(dataType) {
            return dataType.indexOf('PRIMARY KEY') >= 0
          }))

      for (var attr in attributes) {
        if (attributes.hasOwnProperty(attr)) {
          var dataType = this.mssqlDataTypeMapping(tableName, attr, attributes[attr])

          if (primaryKeys.length > 1) {
            dataType = dataType.replace(/ PRIMARY KEY/, '')
          }

          attrStr.push(QueryGenerator.addQuotes(attr) + " " + dataType)
        }
      }

      if (primaryKeys.length > 1) {
        attrStr.push('PRIMARY KEY(' + primaryKeys.map(function(column){return QueryGenerator.addQuotes(column)}).join(', ') + ')')
      }

      var values = {
        unquotedTable: tableName,
        table: QueryGenerator.addQuotes(tableName),
        attributes: attrStr.join(", ")
      }

      return Utils._.template(query)(values).trim() + ";"
    },

    /*
     Returns a query for dropping a table.
     */
    dropTableQuery: function(tableName, options) {
      var query = "IF OBJECT_ID('<%= unquotedTable %>') IS NOT NULL DROP TABLE <%= table %>;"

      return Utils._.template(query)({
        unquotedTable: tableName,
        table: QueryGenerator.addQuotes(tableName)
      })
    },

    /*
     Returns a rename table query.
     Parameters:
     - originalTableName: Name of the table before execution.
     - futureTableName: Name of the table after execution.
     */
    renameTableQuery: function(originalTableName, futureTableName) {
      throwMethodUndefined('renameTableQuery');
    },

    /*
     Returns a query, which gets all available table names in the database.
     */
    showTablesQuery: function() {
      return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'";
    },

    /*
     Returns a query, which adds an attribute to an existing table.
     Parameters:
     - tableName: Name of the existing table.
     - attributes: A hash with attribute-attributeOptions-pairs.
     - key: attributeName
     - value: A hash with attribute specific options:
     - type: DataType
     - defaultValue: A String with the default value
     - allowNull: Boolean
     */
    addColumnQuery: function(tableName, attributes) {
      throwMethodUndefined('addColumnQuery');
    },

    /*
     Returns a query, which removes an attribute from an existing table.
     Parameters:
     - tableName: Name of the existing table
     - attributeName: Name of the obsolete attribute.
     */
    removeColumnQuery: function(tableName, attributeName) {
      throwMethodUndefined('removeColumnQuery');
    },

    /*
     Returns a query, which modifies an existing attribute from a table.
     Parameters:
     - tableName: Name of the existing table.
     - attributes: A hash with attribute-attributeOptions-pairs.
     - key: attributeName
     - value: A hash with attribute specific options:
     - type: DataType
     - defaultValue: A String with the default value
     - allowNull: Boolean
     */
    changeColumnQuery: function(tableName, attributes) {
      throwMethodUndefined('changeColumnQuery');
    },

    /*
     Returns a query, which renames an existing attribute.
     Parameters:
     - tableName: Name of an existing table.
     - attrNameBefore: The name of the attribute, which shall be renamed.
     - attrNameAfter: The name of the attribute, after renaming.
     */
    renameColumnQuery: function(tableName, attrNameBefore, attrNameAfter) {
      throwMethodUndefined('renameColumnQuery');
    },

    /**
      Mostly the same logic as of the abstract query generator.
      We will remove the explicit identity values, though.
    **/
    insertQuery: function(table, valueHash, modelAttributes) {
      return AbstractQueryGenerator.insertQuery.call(
        this, table,
        Utils.removeIdentityColumnsFromHash(valueHash, modelAttributes),
        modelAttributes
      )
    },

    /*
     Returns an insert into command for multiple values.
     Parameters: table name + list of hashes of attribute-value-pairs.
     */
    bulkInsertQuery: function(tableName, attrValueHashes, options) {
      var table      = QueryGenerator.addQuotes(tableName)
        , attributes = Object.keys(attrValueHashes[0]).map(function(attr){return QueryGenerator.addQuotes(attr)}).join(",")
        , tuples     = []

      options = Utils._.extend({
        ignoreDuplicates: false
      }, options || {})

      Utils._.forEach(attrValueHashes, function(attrValueHash) {
        tuples.push("(" +
          Utils._.values(attrValueHash).map(processAndEscapeValue).join(",") +
        ")")
      })

      return "INSERT INTO " + table + " (" + attributes + ") VALUES " + tuples.join(",") + ";"
    },

    /*
     Returns an update query.
     Parameters:
     - tableName -> Name of the table
     - values -> A hash with attribute-value-pairs
     - where -> A hash with conditions (e.g. {name: 'foo'})
     OR an ID as integer
     OR a string with conditions (e.g. 'name="foo"').
     If you use a string, you have to escape it on your own.
    */
    updateQuery: function(tableName, attrValueHash, where, options, attributes) {
      attrValueHash = Utils.removeNullValuesFromHash(attrValueHash, this.options.omitNull, options)
      attrValueHash = Utils.removeIdentityColumnsFromHash(attrValueHash, attributes, options)

      var values = []

      for (var key in attrValueHash) {
        var value  = attrValueHash[key]
          , _value = processAndEscapeValue(value)

        values.push(QueryGenerator.addQuotes(key) + "=" + _value)
      }

      var query = "UPDATE " + QueryGenerator.addQuotes(tableName) +
        " SET " + values.join(",") +
        " WHERE " + AbstractQueryGenerator.getWhereConditions.call(this, where)

      return query
    },

    /*
     Returns a deletion query.
     Parameters:
     - tableName -> Name of the table
     - where -> A hash with conditions (e.g. {name: 'foo'})
     OR an ID as integer
     OR a string with conditions (e.g. 'name="foo"').
     If you use a string, you have to escape it on your own.
     Options:
     - limit -> Maximaum count of lines to delete
     */
    deleteQuery: function(tableName, where, options) {
      options = options || {}

      var table = QueryGenerator.addQuotes(tableName)
      where = AbstractQueryGenerator.getWhereConditions.call(this, where)

      if(Utils._.isUndefined(options.limit)) {
        options.limit = 1;
      }

      var query;

      if(options.limit){
        query = "DELETE TOP(<%= limit %>) FROM " + table + " WHERE " + where
      }
      else{
        query = "DELETE FROM " + table + " WHERE " + where
      }

      return Utils._.template(query)(options);
    },

    /*
     Returns a bulk deletion query.
     Parameters:
     - tableName -> Name of the table
     - where -> A hash with conditions (e.g. {name: 'foo'})
     OR an ID as integer
     OR a string with conditions (e.g. 'name="foo"').
     If you use a string, you have to escape it on your own.
     */
    bulkDeleteQuery: function(tableName, where, options) {
      options = options || {}

      var table = QueryGenerator.addQuotes(tableName)
      where = AbstractQueryGenerator.getWhereConditions.call(this, where)

      var query = "DELETE FROM " + table + " WHERE " + where

      return query
    },

    /*
     Returns an update query.
     Parameters:
     - tableName -> Name of the table
     - values -> A hash with attribute-value-pairs
     - where -> A hash with conditions (e.g. {name: 'foo'})
     OR an ID as integer
     OR a string with conditions (e.g. 'name="foo"').
     If you use a string, you have to escape it on your own.
     */
    incrementQuery: function(tableName, attrValueHash, where) {
      attrValueHash = Utils.removeNullValuesFromHash(attrValueHash, this.options.omitNull)

      var values = []

      for (var key in attrValueHash) {
        if(attrValueHash.hasOwnProperty(key)){
          var value  = attrValueHash[key]
            , _value = processAndEscapeValue(value)

          values.push(QueryGenerator.addQuotes(key) + "=" + QueryGenerator.addQuotes(key) + " + " + _value)
        }
      }

      var table = QueryGenerator.addQuotes(tableName)
      values = values.join(",")
      where = AbstractQueryGenerator.getWhereConditions.call(this, where)

      var query = "UPDATE " + table + " SET " + values + " WHERE " + where

      return query
    },

    /*
     Returns an add index query.
     Parameters:
     - tableName -> Name of an existing table.
     - attributes:
     An array of attributes as string or as hash.
     If the attribute is a hash, it must have the following content:
     - attribute: The name of the attribute/column
     - length: An integer. Optional
     - order: 'ASC' or 'DESC'. Optional
     - options:
     - indicesType: UNIQUE|FULLTEXT|SPATIAL
     - indexName: The name of the index. Default is <tableName>_<attrName1>_<attrName2>
     - parser
     */
    addIndexQuery: function(tableName, attributes, options) {
      var transformedAttributes = attributes.map(function(attribute) {
        if(typeof attribute === 'string') {
          return attribute
        } else {
          var result = ""

          if (!attribute.attribute) {
            throw new Error('The following index attribute has no attribute: ' + util.inspect(attribute))
          }

          result += attribute.attribute

          if (attribute.length) {
            result += '(' + attribute.length + ')'
          }

          if (attribute.order) {
            result += ' ' + attribute.order
          }

          return result
        }
      }.bind(this))

      var onlyAttributeNames = attributes.map(function(attribute) {
        return (typeof attribute === 'string') ? attribute : attribute.attribute
      }.bind(this))

      options = Utils._.extend({
        indicesType: null,
        indexName: Utils._.underscored(tableName + '_' + onlyAttributeNames.join('_')),
        parser: null
      }, options || {})

      return Utils._.compact([
        "CREATE", options.indicesType, "INDEX", options.indexName,
        (options.indexType ? ('USING ' + options.indexType) : undefined),
        "ON", tableName, '(' + transformedAttributes.join(', ') + ')',
        (options.parser ? "WITH PARSER " + options.parser : undefined)
      ]).join(' ')
    },

    /*
     Returns an show index query.
     Parameters:
     - tableName: Name of an existing table.
     - options:
     - database: Name of the database.
     */
    showIndexQuery: function(tableName, options) {
      var sql = "SELECT OBJECT_SCHEMA_NAME(T.[object_id],DB_ID()) AS [Schema],  " +
        "T.[name] AS [table_name], I.[name] AS [Key_name], AC.[name] AS [column_name],  " +
        "I.[type_desc], I.[is_unique], I.[data_space_id], I.[ignore_dup_key], I.[is_primary_key], " +
        "I.[is_unique_constraint], I.[fill_factor],    I.[is_padded], I.[is_disabled], I.[is_hypothetical], " +
        "I.[allow_row_locks], I.[allow_page_locks], IC.[is_descending_key], IC.[is_included_column] " +
      "FROM sys.[tables] AS T  " +
        "INNER JOIN sys.[indexes] I ON T.[object_id] = I.[object_id]  " +
        "INNER JOIN sys.[index_columns] IC ON I.[object_id] = IC.[object_id] " +
        "INNER JOIN sys.[all_columns] AC ON T.[object_id] = AC.[object_id] AND IC.[column_id] = AC.[column_id] " +
      "WHERE T.[is_ms_shipped] = 0 AND I.[type_desc] <> 'HEAP' AND T.[name] = '<%= tableName %>'" +
      "ORDER BY T.[name], I.[index_id], IC.[key_ordinal]"

      return Utils._.template(sql)({
        tableName: tableName,
        options: (options || {}).database ? ' FROM `' + options.database + '`' : ''
      })
    },

    /*
     Returns a remove index query.
     Parameters:
     - tableName: Name of an existing table.
     - indexNameOrAttributes: The name of the index as string or an array of attribute names.
     */
    removeIndexQuery: function(tableName, indexNameOrAttributes) {
      var sql       = "DROP INDEX <%= indexName %> ON <%= tableName %>"
        , indexName = indexNameOrAttributes

      if (typeof indexName !== 'string') {
        indexName = Utils._.underscored(tableName + '_' + indexNameOrAttributes.join('_'))
      }

      return Utils._.template(sql)({ tableName: tableName, indexName: indexName })
    },

    /*
     Takes a hash and transforms it into a mysql where condition: {key: value, key2: value2} ==> key=value AND key2=value2
     The values are transformed by the relevant datatype.
     */
    hashToWhereConditions: function(hash) {
      var result = []

      for (var key in hash) {
        var value = hash[key]

        //handle qualified key names
        var _key   = key.split('.').map(function(col){return QueryGenerator.addQuotes(col)}).join(".")
          , _value = null

        if (Array.isArray(value)) {
          if (value.length === 0) { value = [null] }
          _value = "(" + value.map(function(subValue) {
            return processAndEscapeValue(subValue);
          }).join(',') + ")"

          result.push([_key, _value].join(" IN "))
        } else if ((value) && (typeof value === "object") && !(value instanceof Date)) {
          //using as sentinel for join column => value
          _value = value.join.split('.').map(function(col){return QueryGenerator.addQuotes(col)}).join(".")
          result.push([_key, _value].join("="))
        } else {
          _value = processAndEscapeValue(value)
          result.push((_value == 'NULL') ? _key + " IS NULL" : [_key, _value].join("="))
        }
      }

      return result.join(' AND ')
    },

    /*
     This method transforms an array of attribute hashes into equivalent
     sql attribute definition.
     */
    attributesToSQL: function(attributes) {
      var result = {}

      for (var name in attributes) {
        var dataType = attributes[name]

        if (Utils.isHash(dataType)) {
          var template


          if (dataType.type.toString() === DataTypes.ENUM.toString()) {
            if (Array.isArray(dataType.values) && (dataType.values.length > 0)) {
              var maxLength = Math.max.apply(
                null,
                Utils._.map(dataType.values, function(value) {
                  return value.length
                })
              )

              var values = Utils._.map(dataType.values, function(value) {
                return SqlString.escape(value)
              }).join(", ")

              template = "VARCHAR(" + maxLength + ") CHECK (" + name + " IN (" + values + "))"
            } else {
              throw new Error('Values for ENUM haven\'t been defined.')
            }
          } else {
            template = dataType.type.toString();
          }

          if(dataType.type.toString().indexOf('TINYINT(') >= 0){
            template = template.replace(/TINYINT\(.\)/, 'TINYINT')
          }

          if(dataType.hasOwnProperty('zeroFill') && dataType.zeroFill){
            throw new Error('MSSQL does not support ZEROFILL')
          }

          if(dataType.hasOwnProperty('unsigned') && dataType.unsigned){
            throw new Error('MSSQL does not support UNSIGNED')
          }

          if (dataType.hasOwnProperty('allowNull') && (!dataType.allowNull)) {
            template += " NOT NULL"
          }

          if (dataType.autoIncrement) {
            template += " IDENTITY"
          }

          if ((dataType.defaultValue !== undefined) && (dataType.defaultValue != DataTypes.NOW)) {
            template += " DEFAULT " + SqlString.escape(dataType.defaultValue)
          }

          if (dataType.unique) {
            template += " UNIQUE"
          }


          if (dataType.primaryKey) {
            template += " PRIMARY KEY"
          }

          if(dataType.allowNull || (!(dataType.autoIncrement || dataType.defaultValue || dataType.unique || dataType.primaryKey) && dataType.allowNull === undefined)){
            template += " NULL"
          }

          if (dataType.references) {
            template += " REFERENCES " + QueryGenerator.addQuotes(dataType.references)


            if (dataType.referencesKey) {
              template += " (" + QueryGenerator.addQuotes(dataType.referencesKey) + ")"
            } else {
              template += " (" + QueryGenerator.addQuotes('id') + ")"
            }

            if (dataType.onDelete) {
              if (dataType.onDelete.toUpperCase().trim() === 'RESTRICT') {
                template += " ON DELETE NO ACTION"
              } else {
                template += " ON DELETE " + dataType.onDelete.toUpperCase()
              }
            }

            if (dataType.onUpdate) {
              if (dataType.onUpdate.toUpperCase().trim() === 'RESTRICT') {
                template += " ON UPDATE NO ACTION"
              } else {
                template += " ON UPDATE " + dataType.onUpdate.toUpperCase()
              }
            }

          }

          result[name] = template
        } else {
          result[name] = dataType
        }
      }

      return result
    },

    /*
     Returns all auto increment fields of a factory.
     */
    findAutoIncrementField: function(factory) {
      var fields = []

      for (var name in factory.attributes) {
        if (factory.attributes.hasOwnProperty(name)) {
          var definition = factory.attributes[name]

          if (definition && (definition.indexOf('IDENTITY') > -1)) {
            fields.push(name)
          }
        }
      }

      return fields
    },

    enableForeignKeyConstraintsQuery: function() {
      return "exec sp_msforeachtable @command1=\"print '?'\", @command2=\"ALTER TABLE ? WITH CHECK CHECK CONSTRAINT all\""
    },

    /*
     Globally disable foreign key constraints
     */
    disableForeignKeyConstraintsQuery: function() {
      return "EXEC sp_msforeachtable \"ALTER TABLE ? NOCHECK CONSTRAINT all\""
    },

    removeQuotes: function (s, quoteChar) {
      quoteChar = quoteChar || '"';
      return s.replace(new RegExp(quoteChar, 'g'), '');
    },

    addQuotes: function (s, quoteChar) {
      quoteChar = quoteChar || '"';
      return QueryGenerator.removeQuotes(s, quoteChar)
        .split('.')
        .map(function(e) { return quoteChar + String(e) + quoteChar })
        .join('.');
    },

    quoteIdentifier: function(identifier) {
      return Utils.addTicks(identifier, '"')
    },

    quoteIdentifiers: function(identifiers) {
      var self = this

      return identifiers.split('.').map(function(v) {
        return self.quoteIdentifier(v)
      }).join('.')
    },

    quoteTable: function(table) {
      return this.quoteIdentifiers(table)
    },

    /**
     * Generates an SQL query that returns all foreign keys of a table.
     *
     * @param  {String} tableName  The name of the table.
     * @param  {String} schemaName The name of the schema.
     * @return {String}            The generated sql query.
     */
    getForeignKeysQuery: function(tableName, schemaName) {
      return "select CONSTRAINT_NAME as constraint_name from INFORMATION_SCHEMA.TABLE_CONSTRAINTS where CONSTRAINT_TYPE='FOREIGN KEY' and TABLE_NAME='" + tableName + "'"
    },

    /**
     * Generates an SQL query that removes a foreign key from a table.
     *
     * @param  {String} tableName  The name of the table.
     * @param  {String} foreignKey The name of the foreign key constraint.
     * @return {String}            The generated sql query.
     */
    dropForeignKeyQuery: function(tableName, foreignKey) {
      return 'ALTER TABLE ' + this.quoteIdentifier(tableName) + ' DROP ' + this.quoteIdentifier(foreignKey) + ';'
    },

    /**
     * Returns a query that starts a transaction.
     *
     * @param  {Object} options An object with options.
     * @return {String}         The generated sql query.
     */
    startTransactionQuery: function(options) {
      return "-- Starting transaction ..."
    },

    setIsolationLevelQuery: function(value) {
      return "-- Setting isolation level to: " + value
    },

    setAutocommitQuery: function(value) {
      return "SET IMPLICIT_TRANSACTIONS " + (value ? 'OFF' : 'ON') + ';'
    },

    commitTransactionQuery: function() {
      return "-- Committing transaction ..."
    },

    rollbackTransactionQuery: function(options) {
      return "-- Rolling back transaction ..."
    },

    mssqlDataTypeMapping: function(tableName, attr, dataType) {
      if (Utils._.includes(dataType, 'UUID')) {
        dataType = dataType.replace(/UUID/, 'CHAR(36)')
      }

      return dataType
    },

    describeTableQuery: function(tableName, schema, schemaDelimiter) {
      return "select DATA_TYPE as Type, COLUMN_NAME as Field, IS_NULLABLE AS 'Null', COLUMN_DEFAULT As 'Default', CHARACTER_MAXIMUM_LENGTH as Length from information_schema.columns where TABLE_NAME = '" + tableName + "'"
    },

    selectQuery: function(tableName, options, factory) {
      var sql = AbstractQueryGenerator.selectQuery.call(
        this, tableName, Utils._.omit(options, 'limit', 'offset'), factory
      )

      sql = this.addLimitAndOffset(options, sql)

      return sql
    },

    addLimitAndOffset: function(options, query) {
      query = query || ""

      if (options.hasOwnProperty('limit')) {
        query = query.replace(/^(SELECT)/, "SELECT TOP " + options.limit)
      }

      if (options.hasOwnProperty('offset')) {
        throw "omg wtf"
      }

      return query
    }
  }

  var throwMethodUndefined = function(methodName) {
    throw new Error('The method "' + methodName + '" is not defined! Please add it to your sql dialect.');
  }

  return Utils._.extend({}, AbstractQueryGenerator, QueryGenerator)
})()
